/**
 * ScrollMinimap — 消息导航迷你地图
 *
 * 在消息区域右上角显示短横杠代表每条消息的位置，
 * 点击迷你地图后弹出消息预览列表，点击可跳转到对应消息。
 * 必须放在 StickToBottom（Conversation）内部使用。
 */

import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Search } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { getModelLogo } from '@/lib/model-logo'
import { cn } from '@/lib/utils'

export interface MinimapItem {
  id: string
  role: 'user' | 'assistant' | 'status'
  preview: string
  avatar?: string
  model?: string
}

interface ScrollMinimapProps {
  items: MinimapItem[]
  onScrollToItem?: (id: string) => void
}

/** 最少消息数才显示迷你地图 */
const MIN_ITEMS = 4
/** 迷你地图最多渲染的横杠数 */
const MAX_BARS = 20

function isSetEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) {
    if (!b.has(v)) return false
  }
  return true
}

// ── Markdown 预览配置（轻量级，禁用重量级渲染） ──

const PREVIEW_REMARK_PLUGINS = [remarkGfm]

/* eslint-disable @typescript-eslint/no-explicit-any -- react-markdown components 类型复杂，使用内联对象即可 */
const PREVIEW_MD_COMPONENTS = {
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="text-[11px] opacity-70 truncate">{children}</pre>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="text-[11px] bg-muted/50 px-0.5 rounded">{children}</code>,
  img: () => null as unknown as React.ReactElement,
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
} as const
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 计算 node 相对于 container 的实际顶部偏移（递归累积 offsetTop） */
function getOffsetTopRelativeTo(node: HTMLElement, container: HTMLElement): number {
  let top = 0
  let el: HTMLElement | null = node
  while (el && el !== container) {
    top += el.offsetTop
    el = el.offsetParent as HTMLElement | null
  }
  return top
}

/** 转义正则特殊字符 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function ScrollMinimap({ items, onScrollToItem }: ScrollMinimapProps): React.ReactElement | null {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const [hovered, setHovered] = React.useState(false)
  const [visibleIds, setVisibleIds] = React.useState<Set<string>>(new Set())
  const [canScroll, setCanScroll] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [sidebarTransitioning, setSidebarTransitioning] = React.useState(false)

  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const frameRef = React.useRef<number | null>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const onSidebarTransition = (event: Event): void => {
      const custom = event as CustomEvent<{ active?: boolean }>
      setSidebarTransitioning(Boolean(custom.detail?.active))
    }
    window.addEventListener('proma:sidebar-transition', onSidebarTransition as EventListener)
    return () => window.removeEventListener('proma:sidebar-transition', onSidebarTransition as EventListener)
  }, [])

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    if (sidebarTransitioning) {
      setHovered(false)
      setVisibleIds(new Set())
      return
    }

    const update = (): void => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const nextCanScroll = scrollHeight > clientHeight + 10
      setCanScroll((prev) => (prev === nextCanScroll ? prev : nextCanScroll))
      if (scrollHeight <= 0) return

      if (!hovered) return

      const nodes = el.querySelectorAll<HTMLElement>('[data-message-id]')
      const ids = new Set<string>()
      for (const node of nodes) {
        const top = getOffsetTopRelativeTo(node, el)
        const bottom = top + node.offsetHeight
        if (bottom > scrollTop && top < scrollTop + clientHeight) {
          const id = node.getAttribute('data-message-id')
          if (id) ids.add(id)
        }
      }
      setVisibleIds((prev) => (isSetEqual(prev, ids) ? prev : ids))
    }

    const scheduleUpdate = (): void => {
      if (frameRef.current != null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        update()
      })
    }

    scheduleUpdate()
    el.addEventListener('scroll', scheduleUpdate, { passive: true })
    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(el)

    return () => {
      el.removeEventListener('scroll', scheduleUpdate)
      observer.disconnect()
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [scrollRef, items, hovered, sidebarTransitioning])

  React.useEffect(() => {
    if (hovered && searchInputRef.current) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 80)
      return () => clearTimeout(timer)
    }
  }, [hovered])

  React.useEffect(() => {
    if (!hovered) setSearchQuery('')
  }, [hovered])

  const handleTriggerClick = (): void => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setHovered(true)
  }

  const handleMouseLeave = (): void => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setHovered(false), 150)
    setVisibleIds(new Set())
  }

  const scrollToMessage = React.useCallback((id: string) => {
    // 先停止 StickToBottom 自动滚动，避免点击定位后被立即吸到底部
    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const scrollToVisibleTarget = (): boolean => {
      const el = scrollRef.current
      if (!el) return false
      const escapedId = escapeSelectorValue(id)
      const target = el.querySelector<HTMLElement>(`[data-message-id="${escapedId}"]`)
      if (!target) return false

      const offsetTop = getOffsetTopRelativeTo(target, el)
      const targetHeight = target.offsetHeight
      const viewportHeight = el.clientHeight
      const scrollTarget = targetHeight < viewportHeight
        ? offsetTop - (viewportHeight - targetHeight) / 2
        : offsetTop - 32
      el.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' })
      return true
    }

    if (onScrollToItem) {
      onScrollToItem(id)
      let attempts = 0
      const retryWhenMounted = (): void => {
        if (scrollToVisibleTarget()) return
        if (attempts >= 2) return
        attempts += 1
        requestAnimationFrame(retryWhenMounted)
      }
      requestAnimationFrame(retryWhenMounted)
      setHovered(false)
      return
    }

    scrollToVisibleTarget()

    setHovered(false)
  }, [onScrollToItem, scrollRef, stopScroll, stickyState])

  const filteredItems = React.useMemo(() => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter((item) => item.preview.toLowerCase().includes(q))
  }, [items, searchQuery])

  if (items.length < MIN_ITEMS || !canScroll) return null

  const barCount = Math.min(items.length, MAX_BARS)
  const stripHeight = barCount * 6

  return (
    <div
      className={cn(
        'absolute right-2 top-0 z-10 flex items-start transition-[opacity,transform] duration-200 ease-out',
        sidebarTransitioning ? 'opacity-0 translate-x-1 pointer-events-none' : 'opacity-100 translate-x-0'
      )}
      onMouseLeave={handleMouseLeave}
    >
      {hovered && (
        <div
          className="mr-1 w-[280px] rounded-lg border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95 duration-150 origin-top-right flex flex-col overflow-hidden"
          style={{ maxHeight: 'min(420px, 60vh)', marginTop: 12 }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
            <span className="text-xs font-medium text-popover-foreground/70">消息导航</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {visibleIds.size}/{items.length}
            </span>
          </div>

          <div className="px-2 py-1.5 border-b shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              <Input
                ref={searchInputRef}
                placeholder="搜索消息..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={() => {
                  closeTimerRef.current = setTimeout(() => setHovered(false), 300)
                }}
                onFocus={() => {
                  if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
                }}
                className="h-7 text-xs pl-7"
              />
            </div>
          </div>

          <div className="overflow-y-auto flex-1 p-1.5 space-y-0.5 scrollbar-thin">
            {filteredItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                未找到匹配消息
              </div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'flex items-start gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                    visibleIds.has(item.id) && 'bg-accent/50'
                  )}
                  onClick={() => scrollToMessage(item.id)}
                >
                  <ItemIcon item={item} />
                  <div className="flex-1 min-w-0">
                    <HighlightedPreview text={item.preview} query={searchQuery} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label="打开消息导航"
        className="relative mt-3 flex-shrink-0 rounded-sm cursor-pointer"
        style={{ width: 24, height: stripHeight }}
        onClick={handleTriggerClick}
      >
        {Array.from({ length: barCount }, (_, i) => {
          const start = Math.floor((i * items.length) / barCount)
          const end = Math.floor(((i + 1) * items.length) / barCount)
          const group = items.slice(start, end)
          const isVisible = group.some((it) => visibleIds.has(it.id))
          const hasUser = group.some((it) => it.role === 'user')
          const top = ((i + 0.5) / barCount) * 100
          return (
            <div
              key={i}
              className={cn(
                'absolute left-1 h-[2px] w-[20px] rounded-full transition-colors',
                isVisible
                  ? 'bg-primary/60'
                  : hasUser
                    ? 'bg-muted-foreground/25'
                    : 'bg-muted-foreground/45'
              )}
              style={{ top: `${top}%` }}
            />
          )
        })}
      </button>
    </div>
  )
}

function ItemIcon({ item }: { item: MinimapItem }): React.ReactElement {
  if (item.role === 'user' && item.avatar) {
    return <UserAvatar avatar={item.avatar} size={16} className="mt-0.5" />
  }
  if ((item.role === 'assistant') && item.model) {
    return (
      <img
        src={getModelLogo(item.model)}
        alt=""
        className="size-4 shrink-0 mt-0.5 rounded-[20%] object-cover"
      />
    )
  }
  if (item.role === 'status') {
    return <AlertTriangle className="size-4 shrink-0 mt-0.5 text-destructive" />
  }
  return <div className="size-4 shrink-0 mt-0.5 rounded-[20%] bg-muted" />
}

/** Markdown 预览（无搜索时）或 纯文本+高亮（搜索时） */
function HighlightedPreview({ text, query }: { text: string; query: string }): React.ReactElement {
  if (!text) {
    return <span className="text-xs opacity-40">(空消息)</span>
  }

  if (query.trim()) {
    const escaped = escapeRegExp(query)
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return (
      <span className="text-xs text-popover-foreground/80 line-clamp-3">
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase()
            ? <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">{part}</mark>
            : part
        )}
      </span>
    )
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-popover-foreground/80 prose-p:my-0 prose-headings:my-0.5 prose-headings:text-xs prose-li:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 line-clamp-3 overflow-hidden">
      <Markdown remarkPlugins={PREVIEW_REMARK_PLUGINS} components={PREVIEW_MD_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
}
