/**
 * TabBar — 顶部标签栏
 *
 * 显示所有打开的标签页，支持：
 * - 点击切换标签
 * - 中键关闭标签
 * - 拖拽重排序
 * - 溢出时水平滚动
 * - 分屏模式切换按钮
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { PanelRightOpen } from 'lucide-react'
import { appModeAtom } from '@/atoms/app-mode'
import {
  tabsAtom,
  splitLayoutAtom,
  tabStreamingMapAtom,
  activeTabIdAtom,
  sidebarCollapsedAtom,
  openTab,
  closeTab,
  focusTab,
  reorderTabs,
} from '@/atoms/tab-atoms'
import {
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
  currentConversationIdAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  agentSidePanelOpenMapAtom,
  agentSidePanelManualCollapseLockMapAtom,
  agentSidePanelActiveTabMapAtom,
  agentSidePanelWidthMapAtom,
  openAgentSidePanelAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { TabBarItem } from './TabBarItem'
import { SplitModeToggle } from './SplitModeToggle'
import { SessionHeaderControls } from '@/components/app-shell/SessionHeaderControls'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function TabBar(): React.ReactElement {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const streamingMap = useAtomValue(tabStreamingMapAtom)
  const mode = useAtomValue(appModeAtom)
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // per-conversation/session Map atoms（用于关闭标签时清理）
  const setConvModels = useSetAtom(conversationModelsAtom)
  const setConvContextLength = useSetAtom(conversationContextLengthAtom)
  const setConvThinking = useSetAtom(conversationThinkingEnabledAtom)
  const setConvParallel = useSetAtom(conversationParallelModeAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setConvPromptId = useSetAtom(conversationPromptIdAtom)
  const setAgentSidePanelOpen = useSetAtom(agentSidePanelOpenMapAtom)
  const setAgentSidePanelManualCollapseLock = useSetAtom(agentSidePanelManualCollapseLockMapAtom)
  const setAgentSidePanelActiveTab = useSetAtom(agentSidePanelActiveTabMapAtom)
  const setAgentSidePanelWidth = useSetAtom(agentSidePanelWidthMapAtom)
  const openAgentSidePanel = useSetAtom(openAgentSidePanelAtom)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const activeAgentSessionId = activeTab?.type === 'agent'
    ? activeTab.sessionId
    : null
  const fallbackAgentSessionId = React.useMemo(() => {
    if (currentAgentSessionId) return currentAgentSessionId
    for (let i = tabs.length - 1; i >= 0; i -= 1) {
      const tab = tabs[i]
      if (tab?.type === 'agent') return tab.sessionId
    }
    return null
  }, [currentAgentSessionId, tabs])
  const targetAgentSessionId = activeAgentSessionId ?? fallbackAgentSessionId
  const controlsMode: 'chat' | 'agent' = activeTab?.type === 'agent'
    ? 'agent'
    : mode
  const canToggleAgentSidePanel = mode === 'agent' && !!targetAgentSessionId
  const isAgentSidePanelOpen = targetAgentSessionId
    ? (sidePanelOpenMap.get(targetAgentSessionId) ?? false)
    : false

  /** 清理关闭标签对应的 per-conversation/session Map atoms 条目 */
  const cleanupMapAtoms = React.useCallback((tabId: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(tabId)) return prev
      const map = new Map(prev)
      map.delete(tabId)
      return map
    }
    // Chat per-conversation atoms
    setConvModels(deleteKey)
    setConvContextLength(deleteKey)
    setConvThinking(deleteKey)
    setConvParallel(deleteKey)
    setConvPromptId(deleteKey)
    // Agent per-session atoms
    setAgentSidePanelOpen(deleteKey)
    setAgentSidePanelManualCollapseLock(deleteKey)
    setAgentSidePanelActiveTab(deleteKey)
    setAgentSidePanelWidth(deleteKey)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvPromptId, setAgentSidePanelOpen, setAgentSidePanelManualCollapseLock, setAgentSidePanelActiveTab, setAgentSidePanelWidth])

  // 拖拽状态
  const dragState = React.useRef<{
    dragging: boolean
    tabId: string
    startX: number
    startIndex: number
  } | null>(null)

  const handleActivate = React.useCallback((tabId: string) => {
    setLayout((prev) => focusTab(prev, tabId))

    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return

    if (tab.type === 'chat') {
      setAppMode('chat')
      setCurrentConversationId(tab.sessionId)
      return
    }

    setAppMode('agent')
    setCurrentAgentSessionId(tab.sessionId)

    const session = agentSessions.find((s) => s.id === tab.sessionId)
    if (!session?.workspaceId) return

    setCurrentAgentWorkspaceId(session.workspaceId)
    window.electronAPI.updateSettings({
      agentWorkspaceId: session.workspaceId,
    }).catch(console.error)
  }, [
    setLayout,
    tabs,
    setAppMode,
    setCurrentConversationId,
    setCurrentAgentSessionId,
    agentSessions,
    setCurrentAgentWorkspaceId,
  ])

  const handleClose = React.useCallback((tabId: string) => {
    setTabs((prevTabs) => {
      const result = closeTab(prevTabs, layout, tabId)
      // 需要同时更新 layout，使用 setTimeout 保证原子性
      setTimeout(() => setLayout(result.layout), 0)
      return result.tabs
    })
    // 清理 per-conversation/session Map atoms 条目，防止内存泄漏
    cleanupMapAtoms(tabId)
  }, [layout, setTabs, setLayout, cleanupMapAtoms])

  const handleDragStart = React.useCallback((tabId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return // 只处理左键
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    dragState.current = {
      dragging: false,
      tabId,
      startX: e.clientX,
      startIndex: idx,
    }

    const handleMove = (me: PointerEvent): void => {
      if (!dragState.current) return
      const dx = Math.abs(me.clientX - dragState.current.startX)
      if (dx > 5) dragState.current.dragging = true
    }

    const handleUp = (): void => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      dragState.current = null
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }, [tabs])

  // 水平滚动支持
  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft += e.deltaY
    }
  }, [])

  const handleToggleAgentSidePanel = React.useCallback(() => {
    if (!targetAgentSessionId) return
    const nextOpen = !isAgentSidePanelOpen

    if (nextOpen) {
      openAgentSidePanel({
        sessionId: targetAgentSessionId,
        reason: 'manual',
      })
      return
    }

    setAgentSidePanelOpen((prev) => {
      const current = prev.get(targetAgentSessionId) ?? false
      if (!current) return prev
      const map = new Map(prev)
      map.set(targetAgentSessionId, false)
      return map
    })
    setAgentSidePanelManualCollapseLock((prev) => {
      if (prev.get(targetAgentSessionId) === true) return prev
      const map = new Map(prev)
      map.set(targetAgentSessionId, true)
      return map
    })
  }, [targetAgentSessionId, isAgentSidePanelOpen, setAgentSidePanelOpen, setAgentSidePanelManualCollapseLock, openAgentSidePanel])

  const sidePanelToggleButton = canToggleAgentSidePanel && !isAgentSidePanelOpen && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-[34px] shrink-0 rounded-md border border-border/60 bg-background/65 text-foreground/65 hover:bg-background/90 hover:text-foreground hover:border-border/80 titlebar-no-drag"
          aria-label="打开侧面板"
          onClick={handleToggleAgentSidePanel}
        >
          <PanelRightOpen className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>打开侧面板</p>
      </TooltipContent>
    </Tooltip>
  )
  const rightActionControls = (
    <div className="relative z-[2] h-full shrink-0 flex items-center titlebar-no-drag pointer-events-auto">
      <SplitModeToggle />
      {sidePanelToggleButton}
    </div>
  )
  const leftSessionControls = sidebarCollapsed ? (
    <div className="h-full flex items-end">
      <SessionHeaderControls mode={controlsMode} showCreateButton />
    </div>
  ) : null

  // 将“首个 tab 的左边距”同步到父容器 CSS 变量，供消息区左对齐使用
  React.useLayoutEffect(() => {
    const rootEl = rootRef.current
    const tabsEl = scrollRef.current
    const hostEl = rootEl?.parentElement
    if (!hostEl || !rootEl) return

    const updateOffset = (): void => {
      const latestTabs = scrollRef.current
      const latestRoot = rootRef.current
      if (!latestRoot) return
      if (!latestTabs || tabs.length === 0) {
        hostEl.style.setProperty('--session-content-left-offset', '0px')
        return
      }

      const rootRect = latestRoot.getBoundingClientRect()
      const tabsRect = latestTabs.getBoundingClientRect()
      const offset = Math.max(0, Math.round(tabsRect.left - rootRect.left)) + 1
      hostEl.style.setProperty('--session-content-left-offset', `${offset}px`)
    }

    updateOffset()
    const observer = new ResizeObserver(updateOffset)
    observer.observe(rootEl)
    if (tabsEl) observer.observe(tabsEl)
    window.addEventListener('resize', updateOffset)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateOffset)
      hostEl.style.setProperty('--session-content-left-offset', '0px')
    }
  }, [tabs.length, sidebarCollapsed, mode, activeTabId])

  if (tabs.length === 0) {
    return (
      <div ref={rootRef} className="flex items-end h-[34px] tabbar-bg">
        {leftSessionControls}
        <div className="flex-1 h-full titlebar-drag-region" />
        {rightActionControls}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex items-end h-[34px] tabbar-bg">
      {leftSessionControls}
      {/* 标签区域（可滚动） */}
      <div
        ref={scrollRef}
        className={`flex items-end shrink min-w-0 max-w-full overflow-x-auto scrollbar-none titlebar-no-drag ${sidebarCollapsed ? 'pl-2.5 md:pl-[18px]' : ''}`}
        onWheel={handleWheel}
      >
        {tabs.map((tab, _index) => (
          <TabBarItem
            key={tab.id}
            id={tab.id}
            type={tab.type}
            title={tab.title}
            isActive={tab.id === activeTabId}
            isStreaming={streamingMap.get(tab.id) ?? false}
            onActivate={() => handleActivate(tab.id)}
            onClose={() => handleClose(tab.id)}
            onMiddleClick={() => handleClose(tab.id)}
            onDragStart={(e) => handleDragStart(tab.id, e)}
          />
        ))}
      </div>

      {/* 空白拖拽区域：支持拖动窗口 */}
      <div className="flex-1 h-full titlebar-drag-region" />

      {/* 分屏模式切换 */}
      {rightActionControls}
    </div>
  )
}
