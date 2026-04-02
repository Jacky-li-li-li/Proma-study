/**
 * 滚动位置记忆 — 切换对话/会话时保存并恢复滚动位置
 *
 * 解决切换对话时 StickToBottom 的 spring 动画导致的卡顿和眩晕问题。
 *
 * 原理：
 * - scroll 事件持续保存 distanceFromBottom 到模块级 Map
 * - 切换对话时 ready=false → Conversation 的 resize 切为 "instant"（消除动画）
 * - ready=true 时：有保存位置 → stopScroll() + 设置 scrollTop；无保存 → scrollToBottom("instant")
 * - stopScroll() 让 StickToBottom 内部 isAtBottom=false，ResizeObserver 不再争抢滚动
 *
 * 配合 Conversation 的 resize prop 动态切换：
 *   <Conversation resize={ready ? "smooth" : "instant"}>
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'

/** 模块级缓存：对话/会话 ID → 距底部像素距离 */
const scrollPositionCache = new Map<string, number>()
const pendingScrollToLatest = new Map<string, ScrollBehavior>()
const FORCE_SCROLL_EVENT = 'proma:force-scroll-to-latest'
type ScrollBehavior = 'instant' | 'smooth'

interface ForceScrollDetail {
  id: string
  behavior?: ScrollBehavior
}

export type StreamingViewportPhase = 'idle' | 'locked' | 'settling'

/** 清除指定会话/对话的滚动位置记忆（下次进入时回到底部） */
export function clearScrollPositionMemory(id: string): void {
  scrollPositionCache.delete(id)
}

/** 主动请求某个会话滚动到最新消息位置 */
export function requestScrollToLatest(id: string, behavior: ScrollBehavior = 'instant'): void {
  if (typeof window === 'undefined') return
  pendingScrollToLatest.set(id, behavior)
  window.dispatchEvent(new CustomEvent<ForceScrollDetail>(FORCE_SCROLL_EVENT, {
    detail: { id, behavior },
  }))
}

/**
 * ScrollPositionManager — 放在 Conversation（StickToBottom）内部
 */
export function ScrollPositionManager({ id, ready }: { id: string; ready: boolean }): null {
  const { scrollRef, stopScroll, scrollToBottom } = useStickToBottomContext()
  const restoredRef = useRef(false)
  const prevIdRef = useRef(id)

  // 持续保存滚动位置（距底部距离）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const savePosition = (): void => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      scrollPositionCache.set(id, distanceFromBottom)
    }

    el.addEventListener('scroll', savePosition, { passive: true })
    return () => el.removeEventListener('scroll', savePosition)
  }, [scrollRef, id])

  // id 变化时重置恢复标记
  useEffect(() => {
    if (id !== prevIdRef.current) {
      prevIdRef.current = id
      restoredRef.current = false
    }
  }, [id])

  // ready 后恢复位置 — useLayoutEffect 在浏览器绘制前执行，配合 opacity=0 无闪烁
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return
    restoredRef.current = true

    const el = scrollRef.current
    if (!el) return

    const savedDistance = scrollPositionCache.get(id)
    if (savedDistance != null && savedDistance > 5) {
      // 有保存的非底部位置：停止 StickToBottom 自动滚动，恢复位置
      stopScroll()
      const targetScrollTop = el.scrollHeight - el.clientHeight - savedDistance
      el.scrollTop = Math.max(0, targetScrollTop)
    } else {
      // 无保存位置或在底部：直接跳到底部（无动画）
      scrollToBottom('instant')
    }
  }, [ready, id, scrollRef, stopScroll, scrollToBottom])

  return null
}

/** 监听全局滚动信号，命中当前会话时滚动到底部 */
export function ScrollToLatestOnSignal({ id, ready = true }: { id: string; ready?: boolean }): null {
  const { scrollToBottom } = useStickToBottomContext()
  const pendingBehaviorRef = useRef<ScrollBehavior | null>(null)

  const flushScrollToLatest = useRef<(behavior: ScrollBehavior) => void>(() => {})
  flushScrollToLatest.current = (behavior: ScrollBehavior): void => {
    pendingBehaviorRef.current = null
    pendingScrollToLatest.delete(id)
    requestAnimationFrame(() => {
      void scrollToBottom(behavior)
    })
  }

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<ForceScrollDetail>).detail
      if (!detail || detail.id !== id) return
      const behavior = detail.behavior ?? 'instant'
      pendingBehaviorRef.current = behavior
      if (!ready) return
      flushScrollToLatest.current(behavior)
    }

    window.addEventListener(FORCE_SCROLL_EVENT, handler as EventListener)
    return () => window.removeEventListener(FORCE_SCROLL_EVENT, handler as EventListener)
  }, [id, ready, scrollToBottom])

  useEffect(() => {
    const pendingBehavior = pendingBehaviorRef.current ?? pendingScrollToLatest.get(id)
    if (!ready || !pendingBehavior) return
    flushScrollToLatest.current(pendingBehavior)
  }, [id, ready, scrollToBottom])

  return null
}

/**
 * 流式视口管理器
 *
 * 设计目标：
 * - 流式开始时，如果用户本来就在底部附近，则进入 locked
 * - locked/settling 阶段，内容尺寸变化时始终保持底部贴合
 * - 流式结束后进入 settling，直到内容尺寸稳定一小段时间再退出
 * - 用户手动向上滚动时立即退出，不强行抢回滚动权
 */
export function StreamingViewportManager({
  active,
  ready = true,
  settleMs = 240,
  onPhaseChange,
}: {
  active: boolean
  ready?: boolean
  settleMs?: number
  onPhaseChange?: (phase: StreamingViewportPhase) => void
}): null {
  const { contentRef, scrollToBottom, escapedFromLock, state } = useStickToBottomContext()
  const phaseRef = useRef<StreamingViewportPhase>('idle')
  const prevActiveRef = useRef(active)
  const settleTimerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const setPhase = useCallback((nextPhase: StreamingViewportPhase): void => {
    if (phaseRef.current === nextPhase) return
    phaseRef.current = nextPhase
    onPhaseChange?.(nextPhase)
  }, [onPhaseChange])

  const clearSettleTimer = useCallback((): void => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }, [])

  const scheduleStickToBottom = useCallback((): void => {
    if (!ready || phaseRef.current === 'idle' || rafRef.current != null) return

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!ready || phaseRef.current === 'idle') return
      void scrollToBottom('instant')
    })
  }, [ready, scrollToBottom])

  const armSettling = useCallback((): void => {
    clearSettleTimer()
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      if (phaseRef.current === 'settling') {
        setPhase('idle')
      }
    }, settleMs)
  }, [clearSettleTimer, settleMs, setPhase])

  useEffect(() => {
    if (!ready) return

    const wasActive = prevActiveRef.current
    prevActiveRef.current = active

    if (active && !wasActive) {
      clearSettleTimer()
      if (state.isAtBottom || state.isNearBottom) {
        setPhase('locked')
        scheduleStickToBottom()
      } else {
        setPhase('idle')
      }
      return
    }

    if (!active && wasActive && phaseRef.current === 'locked') {
      setPhase('settling')
      armSettling()
      scheduleStickToBottom()
    }
  }, [active, ready, state.isAtBottom, state.isNearBottom, clearSettleTimer, setPhase, armSettling, scheduleStickToBottom])

  useEffect(() => {
    if (phaseRef.current === 'idle') return

    if (escapedFromLock && !state.isNearBottom) {
      clearSettleTimer()
      setPhase('idle')
    }
  }, [escapedFromLock, state.isNearBottom, clearSettleTimer, setPhase])

  useEffect(() => {
    if (!ready || !active || phaseRef.current !== 'idle') return
    if (escapedFromLock) return

    if (state.isAtBottom || state.isNearBottom) {
      setPhase('locked')
      scheduleStickToBottom()
    }
  }, [active, ready, escapedFromLock, state.isAtBottom, state.isNearBottom, setPhase, scheduleStickToBottom])

  useEffect(() => {
    const contentEl = contentRef.current
    if (!ready || !contentEl) return

    const observer = new ResizeObserver(() => {
      if (phaseRef.current === 'idle') return
      scheduleStickToBottom()
      if (phaseRef.current === 'settling') {
        armSettling()
      }
    })

    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [contentRef, ready, scheduleStickToBottom, armSettling])

  useEffect(() => {
    if (phaseRef.current === 'idle') return
    scheduleStickToBottom()
  }, [scheduleStickToBottom, active])

  useEffect(() => {
    return () => {
      clearSettleTimer()
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [clearSettleTimer])

  return null
}
