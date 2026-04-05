/**
 * LeftSidebar - 左侧导航栏
 *
 * 包含：
 * - Chat/Agent 模式切换器
 * - 导航菜单项（点击切换主内容区视图）
 * - 置顶对话区域（可展开/收起）
 * - 对话列表（新对话按钮 + 右键菜单 + 按 updatedAt 降序排列）
 */

import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { Pin, PinOff, Settings, Trash2, Pencil, ChevronDown, ChevronRight, Plug, Zap, ArrowRightLeft, Search, Archive, ArchiveRestore, ListChecks, X, Plus, PanelLeftClose } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ModeSwitcher } from './ModeSwitcher'
import { SearchDialog } from './SearchDialog'
import { useCreateSession } from '@/hooks/useCreateSession'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { activeViewAtom } from '@/atoms/active-view'
import { appModeAtom, lastOpenedConversationIdAtom, lastOpenedAgentSessionIdAtom } from '@/atoms/app-mode'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'
import {
  conversationsAtom,
  currentConversationIdAtom,
  streamingConversationIdsAtom,
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentRunningSessionIdsAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workspaceCapabilitiesVersionAtom,
  agentSidePanelOpenMapAtom,
  agentSidePanelManualCollapseLockMapAtom,
  agentSidePanelActiveTabMapAtom,
  agentSidePanelWidthMapAtom,
} from '@/atoms/agent-atoms'
import {
  tabsAtom,
  splitLayoutAtom,
  activeTabIdAtom,
  sidebarCollapsedAtom,
  openTab,
  closeTab,
  updateTabTitle,
} from '@/atoms/tab-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { sidebarViewModeAtom } from '@/atoms/sidebar-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { hasUpdateAtom } from '@/atoms/updater'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { WorkspaceSelector } from '@/components/agent/WorkspaceSelector'
import { MoveSessionDialog } from '@/components/agent/MoveSessionDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ActiveView } from '@/atoms/active-view'
import type { ConversationMeta, AgentSessionMeta, WorkspaceCapabilities } from '@proma/shared'

const SIDEBAR_TRANSITION_MS = 300
const SIDEBAR_CONTENT_APPEAR_DELAY_MS = 90

interface SidebarItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  /** 右侧额外元素（如展开/收起箭头） */
  suffix?: React.ReactNode
  onClick?: () => void
}

function SidebarItem({ icon, label, active, suffix, onClick }: SidebarItemProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-[10px] text-[13px] transition-colors duration-100 titlebar-no-drag',
        active
          ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'text-foreground/60 hover:bg-primary/5 hover:text-foreground'
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex-shrink-0 w-[18px] h-[18px]">{icon}</span>
        <span>{label}</span>
      </div>
      {suffix}
    </button>
  )
}

export interface LeftSidebarProps {
  /** 可选固定宽度，默认使用 CSS 响应式宽度 */
  width?: number
}

/** 侧边栏导航项标识 */
type SidebarItemId = 'pinned' | 'all-chats'

/** 导航项到视图的映射 */
const ITEM_TO_VIEW: Record<SidebarItemId, ActiveView> = {
  pinned: 'conversations',
  'all-chats': 'conversations',
}

/** 日期分组标签 */
type DateGroup = '今天' | '昨天' | '更早'

/** 按 updatedAt 将项目分为 今天 / 昨天 / 更早 三组 */
function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: DateGroup; items: T[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: T[] = []
  const yesterday: T[] = []
  const earlier: T[] = []

  for (const item of items) {
    if (item.updatedAt >= todayStart) {
      today.push(item)
    } else if (item.updatedAt >= yesterdayStart) {
      yesterday.push(item)
    } else {
      earlier.push(item)
    }
  }

  const groups: Array<{ label: DateGroup; items: T[] }> = []
  if (today.length > 0) groups.push({ label: '今天', items: today })
  if (yesterday.length > 0) groups.push({ label: '昨天', items: yesterday })
  if (earlier.length > 0) groups.push({ label: '更早', items: earlier })
  return groups
}

export function LeftSidebar({ width }: LeftSidebarProps): React.ReactElement {
  const [activeView, setActiveView] = useAtom(activeViewAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const [activeItem, setActiveItem] = React.useState<SidebarItemId>('all-chats')
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const [currentConversationId, setCurrentConversationId] = useAtom(currentConversationIdAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setLastOpenedConversationId = useSetAtom(lastOpenedConversationIdAtom)
  const setLastOpenedAgentSessionId = useSetAtom(lastOpenedAgentSessionIdAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  /** 待删除对话/会话 ID 列表，非空时显示确认弹窗 */
  const [pendingDeleteIds, setPendingDeleteIds] = React.useState<string[]>([])
  /** 待删除目标类型（避免确认时模式切换导致调用错误 API） */
  const [pendingDeleteMode, setPendingDeleteMode] = React.useState<'chat' | 'agent' | null>(null)
  /** 是否启用多选模式 */
  const [multiSelectEnabled, setMultiSelectEnabled] = React.useState(false)
  /** Chat 模式已选对话 */
  const [selectedConversationIds, setSelectedConversationIds] = React.useState<Set<string>>(new Set())
  /** Agent 模式已选会话 */
  const [selectedAgentSessionIds, setSelectedAgentSessionIds] = React.useState<Set<string>>(new Set())
  /** 待迁移会话 ID，非空时显示迁移对话框 */
  const [moveTargetId, setMoveTargetId] = React.useState<string | null>(null)
  /** 置顶区域展开/收起 */
  const [pinnedExpanded, setPinnedExpanded] = React.useState(true)
  /** Agent 置顶区域展开/收起 */
  const [pinnedAgentExpanded, setPinnedAgentExpanded] = React.useState(true)
  /** 更早分组默认折叠 */
  const [chatEarlierCollapsed, setChatEarlierCollapsed] = React.useState(true)
  /** Agent 更早分组默认折叠 */
  const [agentEarlierCollapsed, setAgentEarlierCollapsed] = React.useState(true)
  const [userProfile, setUserProfile] = useAtom(userProfileAtom)
  const streamingIds = useAtomValue(streamingConversationIdsAtom)
  const mode = useAtomValue(appModeAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)

  // Agent 模式状态
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const [currentAgentSessionId, setCurrentAgentSessionId] = useAtom(currentAgentSessionIdAtom)
  const agentRunningIds = useAtomValue(agentRunningSessionIdsAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 工作区能力（MCP + Skill 计数）
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  // Tab 状态
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom)
  const [expandedContentReady, setExpandedContentReady] = React.useState(!sidebarCollapsed)
  const [expandedContentVisible, setExpandedContentVisible] = React.useState(!sidebarCollapsed)
  const cancelDeleteButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const contentReadyTimerRef = React.useRef<number | null>(null)
  const contentVisibleRafRef = React.useRef<number | null>(null)
  const shouldRenderExpandedContent = !sidebarCollapsed && expandedContentReady
  const expandedContentClass = cn(
    'transition-opacity duration-200',
    expandedContentVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
  )

  // 归档 & 搜索状态
  const [viewMode, setViewMode] = useAtom(sidebarViewModeAtom)
  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)
  const { createChat, createAgent } = useCreateSession()

  // per-conversation/session Map atoms（删除时清理）
  const setConvModels = useSetAtom(conversationModelsAtom)
  const setConvContextLength = useSetAtom(conversationContextLengthAtom)
  const setConvThinking = useSetAtom(conversationThinkingEnabledAtom)
  const setConvParallel = useSetAtom(conversationParallelModeAtom)
  const setConvPromptId = useSetAtom(conversationPromptIdAtom)
  const setAgentSidePanelOpen = useSetAtom(agentSidePanelOpenMapAtom)
  const setAgentSidePanelManualCollapseLock = useSetAtom(agentSidePanelManualCollapseLockMapAtom)
  const setAgentSidePanelActiveTab = useSetAtom(agentSidePanelActiveTabMapAtom)
  const setAgentSidePanelWidth = useSetAtom(agentSidePanelWidthMapAtom)

  /** 清理 per-conversation/session Map atoms 条目 */
  const cleanupMapAtoms = React.useCallback((id: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(id)) return prev
      const map = new Map(prev)
      map.delete(id)
      return map
    }
    setConvModels(deleteKey)
    setConvContextLength(deleteKey)
    setConvThinking(deleteKey)
    setConvParallel(deleteKey)
    setConvPromptId(deleteKey)
    setAgentSidePanelOpen(deleteKey)
    setAgentSidePanelManualCollapseLock(deleteKey)
    setAgentSidePanelActiveTab(deleteKey)
    setAgentSidePanelWidth(deleteKey)
    setSessionChannelMap(deleteKey)
    setSessionModelMap(deleteKey)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvPromptId, setAgentSidePanelOpen, setAgentSidePanelManualCollapseLock, setAgentSidePanelActiveTab, setAgentSidePanelWidth, setSessionChannelMap, setSessionModelMap])

  const currentWorkspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  React.useEffect(() => {
    if (!currentWorkspaceSlug || mode !== 'agent') {
      setCapabilities(null)
      return
    }
    window.electronAPI
      .getWorkspaceCapabilities(currentWorkspaceSlug)
      .then(setCapabilities)
      .catch(console.error)
  }, [currentWorkspaceSlug, mode, activeView, capabilitiesVersion])

  /** 置顶对话列表（仅活跃模式显示，排除 draft） */
  const pinnedConversations = React.useMemo(
    () => {
      if (!shouldRenderExpandedContent || viewMode !== 'active') return []
      return conversations.filter((c) => c.pinned && !c.archived && !draftSessionIds.has(c.id))
    },
    [conversations, viewMode, shouldRenderExpandedContent, draftSessionIds]
  )

  /** 置顶 Agent 会话列表（仅活跃模式显示，跨工作区，排除 draft） */
  const pinnedAgentSessions = React.useMemo(
    () => {
      if (!shouldRenderExpandedContent || viewMode !== 'active') return []
      return agentSessions.filter((s) => s.pinned && !s.archived && !draftSessionIds.has(s.id))
    },
    [agentSessions, viewMode, shouldRenderExpandedContent, draftSessionIds]
  )

  /** 对话按日期分组（根据 viewMode 过滤归档状态，排除 draft） */
  const conversationGroups = React.useMemo(
    () => {
      if (!shouldRenderExpandedContent) return []
      const filtered = viewMode === 'archived'
        ? conversations.filter((c) => c.archived && !draftSessionIds.has(c.id))
        : conversations.filter((c) => !c.archived && !draftSessionIds.has(c.id))
      return groupByDate(filtered)
    },
    [conversations, viewMode, shouldRenderExpandedContent, draftSessionIds]
  )

  /** 已归档对话数量 */
  const archivedConversationCount = React.useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
  )

  /** 已归档 Agent 会话数量（当前工作区） */
  const archivedAgentSessionCount = React.useMemo(
    () => agentSessions.filter((s) => s.archived && (!currentWorkspaceId || s.workspaceId === currentWorkspaceId)).length,
    [agentSessions, currentWorkspaceId]
  )

  const selectedCount = mode === 'agent' ? selectedAgentSessionIds.size : selectedConversationIds.size
  const hasSelection = selectedCount > 0
  const batchArchiveLabel = viewMode === 'archived' ? '取消归档' : '归档'
  const archivedCount = mode === 'agent' ? archivedAgentSessionCount : archivedConversationCount
  const canToggleArchivedView = archivedCount > 0 || viewMode === 'archived'

  // 初始加载对话列表 + 用户档案 + Agent 会话
  React.useEffect(() => {
    window.electronAPI
      .listConversations()
      .then((list) => {
        setConversations(list)
      })
      .catch(console.error)
    window.electronAPI
      .getUserProfile()
      .then(setUserProfile)
      .catch(console.error)
    window.electronAPI
      .listAgentSessions()
      .then(setAgentSessions)
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setConversations, setUserProfile, setAgentSessions])

  // 窗口聚焦时重新同步列表，修复长时间后前后端不一致
  React.useEffect(() => {
    const handleFocus = (): void => {
      window.electronAPI.listConversations().then(setConversations).catch(console.error)
      window.electronAPI.listAgentSessions().then(setAgentSessions).catch(console.error)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [setConversations, setAgentSessions])

  /** 处理导航项点击 */
  const handleItemClick = (item: SidebarItemId): void => {
    if (item === 'pinned') {
      // 置顶按钮仅切换展开/收起，不改变 activeView
      setPinnedExpanded((prev) => !prev)
      return
    }
    setActiveItem(item)
    setActiveView(ITEM_TO_VIEW[item])
  }

  const blurActiveElement = React.useCallback((): void => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  }, [])

  const openDeleteDialog = React.useCallback((ids: string[], targetMode: 'chat' | 'agent'): void => {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return
    // 先让编辑器失焦，再在下一帧打开弹窗，避免 Radix 设置 aria-hidden 时仍保留焦点。
    blurActiveElement()
    window.requestAnimationFrame(() => {
      blurActiveElement()
      setPendingDeleteMode(targetMode)
      setPendingDeleteIds(uniqueIds)
    })
  }, [blurActiveElement])

  const handleCreateSession = React.useCallback((): void => {
    if (mode === 'agent') {
      void createAgent()
      return
    }
    void createChat()
  }, [mode, createAgent, createChat])

  const clearSelections = React.useCallback((): void => {
    setSelectedConversationIds(new Set())
    setSelectedAgentSessionIds(new Set())
  }, [])

  // 切换模式时重置归档视图
  React.useEffect(() => {
    setViewMode('active')
    setMultiSelectEnabled(false)
    clearSelections()
  }, [mode, setViewMode, clearSelections])

  // 切换活跃/归档视图时清空当前选择，避免批量操作作用于隐藏项
  React.useEffect(() => {
    clearSelections()
  }, [viewMode, clearSelections])

  // 会话列表变化时，裁剪已删除/不可用的选择项
  React.useEffect(() => {
    setSelectedConversationIds((prev) => {
      if (prev.size === 0) return prev
      const valid = new Set(conversations.map((c) => c.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [conversations])

  React.useEffect(() => {
    setSelectedAgentSessionIds((prev) => {
      if (prev.size === 0) return prev
      const valid = new Set(agentSessions.map((s) => s.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [agentSessions])

  /** 选择对话（打开或聚焦标签页 / 多选切换） */
  const handleSelectConversation = (
    id: string,
    title: string,
    event?: React.MouseEvent<HTMLDivElement>,
  ): void => {
    const enterSelectMode = multiSelectEnabled || !!event?.metaKey || !!event?.ctrlKey || selectedConversationIds.size > 0
    if (enterSelectMode) {
      if (event?.metaKey || event?.ctrlKey) setMultiSelectEnabled(true)
      setSelectedConversationIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return
    }

    // 记录上次打开的会话 ID
    setLastOpenedConversationId(id)

    const result = openTab(tabs, layout, { type: 'chat', sessionId: id, title })
    setTabs(result.tabs)
    setLayout(result.layout)
    setCurrentConversationId(id)
    setActiveView('conversations')
    setActiveItem('all-chats')
  }

  /** 请求删除对话（弹出确认框） */
  const handleRequestDelete = (id: string): void => {
    openDeleteDialog([id], mode === 'agent' ? 'agent' : 'chat')
  }

  /** 重命名对话标题 */
  const handleRename = async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateConversationTitle(id, newTitle)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 同步更新标签页标题
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名对话失败:', error)
    }
  }

  /** 切换对话置顶状态 */
  const handleTogglePin = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.togglePinConversation(id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
    } catch (error) {
      console.error('[侧边栏] 切换置顶失败:', error)
    }
  }

  /** 切换对话归档状态 */
  const handleToggleArchive = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveConversation(id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      toast.success(updated.archived ? '已归档' : '已取消归档')
    } catch (error) {
      console.error('[侧边栏] 切换归档失败:', error)
    }
  }

  /** 批量切换归档状态 */
  const handleBatchToggleArchive = async (): Promise<void> => {
    const selectedIds = mode === 'agent'
      ? [...selectedAgentSessionIds]
      : [...selectedConversationIds]
    if (selectedIds.length === 0) return

    try {
      if (mode === 'agent') {
        const idSet = new Set(selectedIds)
        const targets = agentSessions.filter((s) => idSet.has(s.id))
        const shouldArchive = targets.some((s) => !s.archived)
        const updates = await Promise.all(
          targets
            .filter((s) => s.archived !== shouldArchive)
            .map((s) => window.electronAPI.toggleArchiveAgentSession(s.id))
        )
        if (updates.length > 0) {
          const updatedMap = new Map(updates.map((s) => [s.id, s]))
          setAgentSessions((prev) => prev.map((s) => updatedMap.get(s.id) ?? s))
        }
        toast.success(shouldArchive ? '已归档所选会话' : '已取消归档所选会话')
      } else {
        const idSet = new Set(selectedIds)
        const targets = conversations.filter((c) => idSet.has(c.id))
        const shouldArchive = targets.some((c) => !c.archived)
        const updates = await Promise.all(
          targets
            .filter((c) => c.archived !== shouldArchive)
            .map((c) => window.electronAPI.toggleArchiveConversation(c.id))
        )
        if (updates.length > 0) {
          const updatedMap = new Map(updates.map((c) => [c.id, c]))
          setConversations((prev) => prev.map((c) => updatedMap.get(c.id) ?? c))
        }
        toast.success(shouldArchive ? '已归档所选对话' : '已取消归档所选对话')
      }
    } catch (error) {
      console.error('[侧边栏] 批量切换归档失败:', error)
    } finally {
      clearSelections()
      setMultiSelectEnabled(false)
    }
  }

  /** 批量删除请求 */
  const handleRequestBatchDelete = (): void => {
    const selectedIds = mode === 'agent'
      ? [...selectedAgentSessionIds]
      : [...selectedConversationIds]
    if (selectedIds.length === 0) return
    openDeleteDialog(selectedIds, mode === 'agent' ? 'agent' : 'chat')
  }

  /** 确认删除对话 */
  const handleConfirmDelete = async (
    idsInput: string[] = pendingDeleteIds,
    targetMode: 'chat' | 'agent' = pendingDeleteMode ?? (mode === 'agent' ? 'agent' : 'chat'),
  ): Promise<void> => {
    if (idsInput.length === 0) return
    const ids = [...new Set(idsInput)]
    const idSet = new Set(ids)

    // 先关闭确认弹窗，避免删除进行中输入框被自动聚焦而触发 aria-hidden 焦点警告。
    setPendingDeleteIds([])
    setPendingDeleteMode(null)
    blurActiveElement()

    let nextTabs = tabs
    let nextLayout = layout
    for (const id of ids) {
      const tabResult = closeTab(nextTabs, nextLayout, id)
      nextTabs = tabResult.tabs
      nextLayout = tabResult.layout
      cleanupMapAtoms(id)
    }
    setTabs(nextTabs)
    setLayout(nextLayout)

    // 清理 draft 标记（如有）
    setDraftSessionIds((prev: Set<string>) => {
      if (ids.every((id) => !prev.has(id))) return prev
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })

    if (targetMode === 'agent') {
      try {
        await Promise.all(ids.map((id) => window.electronAPI.deleteAgentSession(id)))
        // 全量刷新确保与后端同步
        const sessions = await window.electronAPI.listAgentSessions()
        setAgentSessions(sessions)
        if (currentAgentSessionId && idSet.has(currentAgentSessionId)) {
          setCurrentAgentSessionId(null)
        }
      } catch (error) {
        console.error('[侧边栏] 删除 Agent 会话失败:', error)
        // 即使后端报错，也从本地列表移除（可能是会话已不存在）
        setAgentSessions((prev) => prev.filter((s) => !idSet.has(s.id)))
        if (currentAgentSessionId && idSet.has(currentAgentSessionId)) {
          setCurrentAgentSessionId(null)
        }
      } finally {
        setPendingDeleteIds([])
        setPendingDeleteMode(null)
        clearSelections()
        setMultiSelectEnabled(false)
      }
      return
    }

    try {
      await Promise.all(ids.map((id) => window.electronAPI.deleteConversation(id)))
      // 全量刷新确保与后端同步
      const conversations = await window.electronAPI.listConversations()
      setConversations(conversations)
      if (currentConversationId && idSet.has(currentConversationId)) {
        setCurrentConversationId(null)
      }
    } catch (error) {
      console.error('[侧边栏] 删除对话失败:', error)
      // 即使后端报错，也从本地列表移除（可能是对话已不存在）
      setConversations((prev) => prev.filter((c) => !idSet.has(c.id)))
      if (currentConversationId && idSet.has(currentConversationId)) {
        setCurrentConversationId(null)
      }
    } finally {
      setPendingDeleteIds([])
      setPendingDeleteMode(null)
      clearSelections()
      setMultiSelectEnabled(false)
    }
  }

  /** 选择 Agent 会话（打开或聚焦标签页 / 多选切换） */
  const handleSelectAgentSession = (
    id: string,
    title: string,
    event?: React.MouseEvent<HTMLDivElement>,
  ): void => {
    const enterSelectMode = multiSelectEnabled || !!event?.metaKey || !!event?.ctrlKey || selectedAgentSessionIds.size > 0
    if (enterSelectMode) {
      if (event?.metaKey || event?.ctrlKey) setMultiSelectEnabled(true)
      setSelectedAgentSessionIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return
    }

    // 记录上次打开的会话 ID
    setLastOpenedAgentSessionId(id)

    const result = openTab(tabs, layout, { type: 'agent', sessionId: id, title })
    setTabs(result.tabs)
    setLayout(result.layout)
    setCurrentAgentSessionId(id)
    setActiveView('conversations')
    setActiveItem('all-chats')
  }

  /** 重命名 Agent 会话标题 */
  const handleAgentRename = async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      )
      // 同步更新标签页标题
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名 Agent 会话失败:', error)
    }
  }

  /** 切换 Agent 会话置顶状态 */
  const handleTogglePinAgent = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.togglePinAgentSession(id)
      setAgentSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      )
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话置顶失败:', error)
    }
  }

  /** 切换 Agent 会话归档状态 */
  const handleToggleArchiveAgent = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveAgentSession(id)
      setAgentSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      )
      toast.success(updated.archived ? '已归档' : '已取消归档')
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话归档失败:', error)
    }
  }

  /** 迁移会话到另一个工作区后的回调 */
  const handleSessionMoved = (updatedSession: AgentSessionMeta, targetWorkspaceName: string): void => {
    setAgentSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    )
    // 如果迁移的是当前选中的会话，取消选中并关闭标签页
    if (currentAgentSessionId === updatedSession.id) {
      const tabResult = closeTab(tabs, layout, updatedSession.id)
      setTabs(tabResult.tabs)
      setLayout(tabResult.layout)
      setCurrentAgentSessionId(null)
    }
    setMoveTargetId(null)
    toast.success('会话已迁移', {
      description: `已迁移到「${targetWorkspaceName}」，请切换工作区查看`,
    })
  }

  /** Agent 会话按工作区过滤 + 归档过滤 + 排除 draft */
  const filteredAgentSessions = React.useMemo(
    () => {
      if (!shouldRenderExpandedContent) return []
      const byWorkspace = agentSessions.filter((s) => s.workspaceId === currentWorkspaceId && !draftSessionIds.has(s.id))
      return viewMode === 'archived'
        ? byWorkspace.filter((s) => s.archived)
        : byWorkspace.filter((s) => !s.archived)
    },
    [agentSessions, currentWorkspaceId, viewMode, shouldRenderExpandedContent, draftSessionIds]
  )

  /** Agent 会话按日期分组 */
  const agentSessionGroups = React.useMemo(
    () => groupByDate(filteredAgentSessions),
    [filteredAgentSessions]
  )

  // 删除确认弹窗（collapsed/expanded 共享）
  const deleteDialog = (
    <AlertDialog
      open={pendingDeleteIds.length > 0}
      onOpenChange={(open) => {
        if (!open) {
          setPendingDeleteIds([])
          setPendingDeleteMode(null)
        }
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelDeleteButtonRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          blurActiveElement()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const idsSnapshot = [...pendingDeleteIds]
            const modeSnapshot = pendingDeleteMode ?? (mode === 'agent' ? 'agent' : 'chat')
            void handleConfirmDelete(idsSnapshot, modeSnapshot)
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除{mode === 'agent' ? '会话' : '对话'}</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDeleteIds.length > 1
              ? `删除后将无法恢复，确定要删除这 ${pendingDeleteIds.length} 项吗？`
              : `删除后将无法恢复，确定要删除这个${mode === 'agent' ? '会话' : '对话'}吗？`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelDeleteButtonRef}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // 点击确认时拍快照，避免弹窗关闭清理状态后删除逻辑读到空值
              const idsSnapshot = [...pendingDeleteIds]
              const modeSnapshot = pendingDeleteMode ?? (mode === 'agent' ? 'agent' : 'chat')
              e.preventDefault()
              void handleConfirmDelete(idsSnapshot, modeSnapshot)
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // 迁移会话对话框（collapsed/expanded 共享）
  const moveDialog = (
    <MoveSessionDialog
      open={moveTargetId !== null}
      onOpenChange={(open) => { if (!open) setMoveTargetId(null) }}
      sessionId={moveTargetId ?? ''}
      currentWorkspaceId={currentWorkspaceId ?? undefined}
      workspaces={workspaces}
      onMoved={handleSessionMoved}
    />
  )

  const collapsedWidth = 0
  const expandedWidth = width ?? 280
  const prevCollapsedRef = React.useRef(sidebarCollapsed)
  const mountedRef = React.useRef(false)

  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      prevCollapsedRef.current = sidebarCollapsed
      setExpandedContentReady(!sidebarCollapsed)
      setExpandedContentVisible(!sidebarCollapsed)
      return
    }

    const wasCollapsed = prevCollapsedRef.current
    const fromWidth = wasCollapsed ? collapsedWidth : expandedWidth
    const toWidth = sidebarCollapsed ? collapsedWidth : expandedWidth
    prevCollapsedRef.current = sidebarCollapsed

    if (contentReadyTimerRef.current != null) {
      window.clearTimeout(contentReadyTimerRef.current)
      contentReadyTimerRef.current = null
    }
    if (contentVisibleRafRef.current != null) {
      window.cancelAnimationFrame(contentVisibleRafRef.current)
      contentVisibleRafRef.current = null
    }
    if (sidebarCollapsed) {
      setExpandedContentVisible(false)
      setExpandedContentReady(false)
    } else if (wasCollapsed) {
      // 展开初段仅做布局，随后在动画进行中挂载内容并淡入。
      setExpandedContentVisible(false)
      setExpandedContentReady(false)
      contentReadyTimerRef.current = window.setTimeout(() => {
        setExpandedContentReady(true)
        contentVisibleRafRef.current = window.requestAnimationFrame(() => {
          setExpandedContentVisible(true)
          contentVisibleRafRef.current = null
        })
        contentReadyTimerRef.current = null
      }, SIDEBAR_CONTENT_APPEAR_DELAY_MS)
    } else {
      setExpandedContentReady(true)
      setExpandedContentVisible(true)
    }

    if (fromWidth === toWidth) return

    window.dispatchEvent(new CustomEvent('proma:sidebar-layout-change', {
      detail: { fromWidth, toWidth, durationMs: SIDEBAR_TRANSITION_MS },
    }))
    window.dispatchEvent(new CustomEvent('proma:sidebar-transition', { detail: { active: true } }))
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('proma:sidebar-transition', { detail: { active: false } }))
    }, SIDEBAR_TRANSITION_MS + 20)
    return () => {
      window.clearTimeout(timer)
      if (contentReadyTimerRef.current != null) {
        window.clearTimeout(contentReadyTimerRef.current)
        contentReadyTimerRef.current = null
      }
      if (contentVisibleRafRef.current != null) {
        window.cancelAnimationFrame(contentVisibleRafRef.current)
        contentVisibleRafRef.current = null
      }
    }
  }, [sidebarCollapsed, collapsedWidth, expandedWidth])

  // ===== 折叠状态：侧边栏完全隐藏 =====
  if (sidebarCollapsed) {
    return (
      <>
        {deleteDialog}
        {moveDialog}
        <SearchDialog />
      </>
    )
  }

  // ===== 展开状态：完整侧边栏 =====
  return (
    <div
      className="h-full flex flex-col bg-background/95 backdrop-blur-xl rounded-2xl shadow-xl transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden"
      style={{ width: expandedWidth, minWidth: 180, flexShrink: 1 }}
    >
      {/* 顶部留空，避开 macOS 红绿灯 */}
      <div className="relative pt-[50px]">
        {/* 收起按钮 */}
        <div className="absolute top-1 right-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="size-10 flex items-center justify-center rounded-[10px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag"
              >
                <PanelLeftClose size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">收起侧边栏</TooltipContent>
          </Tooltip>
        </div>
        {/* 模式切换器（自适应当前侧边栏宽度） */}
        <div className="pr-1">
          <ModeSwitcher />
        </div>
      </div>

      {/* Agent 模式：工作区选择器 */}
      {mode === 'agent' && (
        <div className="px-3 pt-3">
          <WorkspaceSelector />
        </div>
      )}

      {/* 顶部功能按钮（等宽）：新会话/已归档/搜索/多选 */}
      <div className="px-3 pt-2 grid grid-cols-4 gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCreateSession}
              className="w-full h-[36px] flex items-center justify-center rounded-[10px] text-foreground/70 bg-primary/5 hover:bg-primary/10 transition-colors duration-100 titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]"
            >
              <Plus size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{mode === 'agent' ? '新会话' : '新对话'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => {
                if (!canToggleArchivedView) return
                setViewMode((prev) => prev === 'archived' ? 'active' : 'archived')
              }}
              disabled={!canToggleArchivedView}
              className={cn(
                'w-full h-[36px] flex items-center justify-center rounded-[10px] transition-colors duration-100 titlebar-no-drag border border-dashed',
                viewMode === 'archived'
                  ? 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/15'
                  : 'text-foreground/40 bg-foreground/[0.04] hover:bg-foreground/[0.08] hover:text-foreground/60 border-foreground/10 hover:border-foreground/20',
                !canToggleArchivedView && 'opacity-40 cursor-not-allowed hover:bg-foreground/[0.04] hover:text-foreground/40 hover:border-foreground/10'
              )}
            >
              <Archive size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {viewMode === 'archived'
              ? `返回活跃${mode === 'agent' ? '会话' : '对话'}`
              : `已归档 (${archivedCount})`}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSearchDialogOpen(true)}
              className="w-full h-[36px] flex items-center justify-center rounded-[10px] text-foreground/40 bg-primary/5 hover:bg-primary/10 hover:text-foreground/60 transition-colors duration-100 titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]"
            >
              <Search size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">搜索 (⌘F)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => {
                setMultiSelectEnabled((prev) => {
                  const next = !prev
                  if (!next) clearSelections()
                  return next
                })
              }}
              className={cn(
                'w-full h-[36px] flex items-center justify-center rounded-[10px] transition-colors duration-100 titlebar-no-drag border border-dashed',
                multiSelectEnabled
                  ? 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/15'
                  : 'text-foreground/40 bg-foreground/[0.04] hover:bg-foreground/[0.08] hover:text-foreground/60 border-foreground/10 hover:border-foreground/20'
              )}
            >
              <ListChecks size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{multiSelectEnabled ? '退出多选' : '多选'}</TooltipContent>
        </Tooltip>
      </div>

      {(multiSelectEnabled || hasSelection) && (
        <div className="px-3 pt-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[10px] bg-foreground/[0.04] border border-foreground/10">
            <span className="flex-1 min-w-0 text-[12px] text-foreground/60 truncate">
              已选 {selectedCount} 项
            </span>
            <button
              onClick={handleBatchToggleArchive}
              disabled={!hasSelection}
              className="px-2 py-1 rounded-md text-[12px] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors titlebar-no-drag"
            >
              {batchArchiveLabel}
            </button>
            <button
              onClick={handleRequestBatchDelete}
              disabled={!hasSelection}
              className="px-2 py-1 rounded-md text-[12px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed transition-colors titlebar-no-drag"
            >
              删除
            </button>
            <button
              onClick={() => {
                clearSelections()
                setMultiSelectEnabled(false)
              }}
              className="p-1 rounded-md text-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground/70 transition-colors titlebar-no-drag"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Chat 模式：导航菜单（置顶区域） */}
      {mode === 'chat' && (
        <div className={cn('flex flex-col gap-1 pt-3 px-3', expandedContentClass)}>
          <SidebarItem
            icon={<Pin size={16} />}
            label="置顶对话"
            suffix={
              pinnedConversations.length > 0 ? (
                pinnedExpanded
                  ? <ChevronDown size={14} className="text-foreground/40" />
                  : <ChevronRight size={14} className="text-foreground/40" />
              ) : undefined
            }
            onClick={() => handleItemClick('pinned')}
          />
        </div>
      )}

      {/* Chat 模式：置顶对话区域 */}
      {mode === 'chat' && pinnedExpanded && pinnedConversations.length > 0 && (
        <div className={cn('px-3 pt-1 pb-1', expandedContentClass)}>
          <div className="flex flex-col gap-0.5 pl-1 border-l-2 border-primary/20 ml-2">
            {pinnedConversations.map((conv) => (
              <ConversationItem
                key={`pinned-${conv.id}`}
                conversation={conv}
                active={conv.id === activeTabId}
                selected={selectedConversationIds.has(conv.id)}
                multiSelect={multiSelectEnabled || selectedConversationIds.size > 0}
                hovered={conv.id === hoveredId}
                streaming={streamingIds.has(conv.id)}
                showPinIcon={false}
                onSelect={(e) => handleSelectConversation(conv.id, conv.title, e)}
                onRequestDelete={() => handleRequestDelete(conv.id)}
                onRename={handleRename}
                onTogglePin={handleTogglePin}
                onToggleArchive={handleToggleArchive}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Agent 模式：导航菜单（置顶区域） */}
      {mode === 'agent' && (
        <div className={cn('flex flex-col gap-1 pt-3 px-3', expandedContentClass)}>
          <SidebarItem
            icon={<Pin size={16} />}
            label="置顶会话"
            suffix={
              pinnedAgentSessions.length > 0 ? (
                pinnedAgentExpanded
                  ? <ChevronDown size={14} className="text-foreground/40" />
                  : <ChevronRight size={14} className="text-foreground/40" />
              ) : undefined
            }
            onClick={() => setPinnedAgentExpanded((prev) => !prev)}
          />
        </div>
      )}

      {/* Agent 模式：置顶会话区域 */}
      {mode === 'agent' && pinnedAgentExpanded && pinnedAgentSessions.length > 0 && (
        <div className={cn('px-3 pt-1 pb-1', expandedContentClass)}>
          <div className="flex flex-col gap-0.5 pl-1 border-l-2 border-primary/20 ml-2">
            {pinnedAgentSessions.map((session) => (
              <AgentSessionItem
                key={`pinned-${session.id}`}
                session={session}
                active={session.id === activeTabId}
                selected={selectedAgentSessionIds.has(session.id)}
                multiSelect={multiSelectEnabled || selectedAgentSessionIds.size > 0}
                hovered={session.id === hoveredId}
                running={agentRunningIds.has(session.id)}
                showPinIcon={false}
                onSelect={(e) => handleSelectAgentSession(session.id, session.title, e)}
                onRequestDelete={() => handleRequestDelete(session.id)}
                onRequestMove={() => setMoveTargetId(session.id)}
                onRename={handleAgentRename}
                onTogglePin={handleTogglePinAgent}
                onToggleArchive={handleToggleArchiveAgent}
                onMouseEnter={() => setHoveredId(session.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 列表区域：根据模式切换 */}
      <div className={cn('flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-none', expandedContentClass)}>
        {mode === 'chat' ? (
          /* Chat 模式：对话按日期分组 */
          conversationGroups.map((group) => (
            <div key={group.label} className="mb-1">
              {(() => {
                const isEarlierGroup = group.label === '更早'
                const isCollapsed = isEarlierGroup ? chatEarlierCollapsed : false
                return (
                  <>
                    <button
                      type="button"
                      className={cn(
                        'w-full px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none flex items-center justify-between',
                        isEarlierGroup && 'hover:text-foreground/60 transition-colors titlebar-no-drag',
                      )}
                      onClick={() => {
                        if (!isEarlierGroup) return
                        setChatEarlierCollapsed((prev) => !prev)
                      }}
                    >
                      <span>{group.label}</span>
                      {isEarlierGroup && (
                        isCollapsed
                          ? <ChevronRight size={12} className="text-foreground/40" />
                          : <ChevronDown size={12} className="text-foreground/40" />
                      )}
                    </button>
                    {!isCollapsed && (
                      <div className="flex flex-col gap-0.5">
                        {group.items.map((conv) => (
                          <ConversationItem
                            key={conv.id}
                            conversation={conv}
                            active={conv.id === activeTabId}
                            selected={selectedConversationIds.has(conv.id)}
                            multiSelect={multiSelectEnabled || selectedConversationIds.size > 0}
                            hovered={conv.id === hoveredId}
                            streaming={streamingIds.has(conv.id)}
                            showPinIcon={!!conv.pinned}
                            onSelect={(e) => handleSelectConversation(conv.id, conv.title, e)}
                            onRequestDelete={() => handleRequestDelete(conv.id)}
                            onRename={handleRename}
                            onTogglePin={handleTogglePin}
                            onToggleArchive={handleToggleArchive}
                            onMouseEnter={() => setHoveredId(conv.id)}
                            onMouseLeave={() => setHoveredId(null)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          ))
        ) : (
          /* Agent 模式：Agent 会话按日期分组 */
          agentSessionGroups.map((group) => (
            <div key={group.label} className="mb-1">
              {(() => {
                const isEarlierGroup = group.label === '更早'
                const isCollapsed = isEarlierGroup ? agentEarlierCollapsed : false
                return (
                  <>
                    <button
                      type="button"
                      className={cn(
                        'w-full px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none flex items-center justify-between',
                        isEarlierGroup && 'hover:text-foreground/60 transition-colors titlebar-no-drag',
                      )}
                      onClick={() => {
                        if (!isEarlierGroup) return
                        setAgentEarlierCollapsed((prev) => !prev)
                      }}
                    >
                      <span>{group.label}</span>
                      {isEarlierGroup && (
                        isCollapsed
                          ? <ChevronRight size={12} className="text-foreground/40" />
                          : <ChevronDown size={12} className="text-foreground/40" />
                      )}
                    </button>
                    {!isCollapsed && (
                      <div className="flex flex-col gap-0.5">
                        {group.items.map((session) => (
                          <AgentSessionItem
                            key={session.id}
                            session={session}
                            active={session.id === activeTabId}
                            selected={selectedAgentSessionIds.has(session.id)}
                            multiSelect={multiSelectEnabled || selectedAgentSessionIds.size > 0}
                            hovered={session.id === hoveredId}
                            running={agentRunningIds.has(session.id)}
                            showPinIcon={!!session.pinned}
                            onSelect={(e) => handleSelectAgentSession(session.id, session.title, e)}
                            onRequestDelete={() => handleRequestDelete(session.id)}
                            onRequestMove={() => setMoveTargetId(session.id)}
                            onRename={handleAgentRename}
                            onTogglePin={handleTogglePinAgent}
                            onToggleArchive={handleToggleArchiveAgent}
                            onMouseEnter={() => setHoveredId(session.id)}
                            onMouseLeave={() => setHoveredId(null)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          ))
        )}
      </div>

      {/* Agent 模式：工作区能力指示器 */}
      {mode === 'agent' && capabilities && (
        <div className={cn('px-3 pb-1', expandedContentClass)}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { setSettingsTab('agent'); setSettingsOpen(true) }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] text-[12px] text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/70 transition-colors titlebar-no-drag"
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <span className="flex items-center gap-1">
                    <Plug size={13} className="text-foreground/40" />
                    <span className="tabular-nums">{capabilities.mcpServers.filter((s) => s.enabled).length}</span>
                    <span className="text-foreground/30">MCP</span>
                  </span>
                  <span className="text-foreground/20">·</span>
                  <span className="flex items-center gap-1">
                    <Zap size={13} className="text-foreground/40" />
                    <span className="tabular-nums">{capabilities.skills.length}</span>
                    <span className="text-foreground/30">Skills</span>
                  </span>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">点击配置 MCP 与 Skills</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* 底部：用户资料 + 设置入口 */}
      <div className="px-3 pb-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors titlebar-no-drag text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <span className="shrink-0">
            <UserAvatar avatar={userProfile.avatar} size={28} />
          </span>
          <span className="flex-1 text-sm truncate text-left">{userProfile.userName}</span>
          <div className="relative flex-shrink-0 text-foreground/40">
            <Settings size={16} />
            {(hasUpdate || hasEnvironmentIssues) && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </div>
        </button>
      </div>

      {deleteDialog}
      {moveDialog}
      <SearchDialog />
    </div>
  )
}

// ===== 对话列表项 =====

interface ConversationItemProps {
  conversation: ConversationMeta
  active: boolean
  selected: boolean
  multiSelect: boolean
  hovered: boolean
  streaming: boolean
  /** 是否在标题旁显示 Pin 图标 */
  showPinIcon: boolean
  onSelect: (event: React.MouseEvent<HTMLDivElement>) => void
  onRequestDelete: () => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function ConversationItem({
  conversation,
  active,
  selected,
  multiSelect,
  hovered,
  streaming,
  showPinIcon,
  onSelect,
  onRequestDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
  onMouseEnter,
  onMouseLeave,
}: ConversationItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  /** 进入编辑模式 */
  const startEdit = (): void => {
    setEditTitle(conversation.title)
    setEditing(true)
    justStartedEditing.current = true
    // 延迟聚焦，等待 ContextMenu 完全关闭后再 focus
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  /** 保存标题 */
  const saveTitle = async (): Promise<void> => {
    // ContextMenu 关闭导致的 blur，忽略
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false)
      return
    }
    await onRename(conversation.id, trimmed)
    setEditing(false)
  }

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const isPinned = !!conversation.pinned

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={(e) => {
        if (multiSelect) return
        e.stopPropagation()
        startEdit()
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-[7px] rounded-[10px] transition-colors duration-100 titlebar-no-drag text-left',
        (selected || active)
          ? 'session-item-selected bg-primary/10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'hover:bg-primary/5'
      )}
    >
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveTitle}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
            maxLength={100}
          />
        ) : (
          <div className={cn(
            'truncate text-[13px] leading-5 flex items-center gap-1.5',
            (active || selected) ? 'text-foreground' : 'text-foreground/80'
          )}>
            {multiSelect && (
              <span
                className={cn(
                  'size-3.5 rounded-[4px] border flex-shrink-0',
                  selected ? 'bg-primary border-primary' : 'border-foreground/30'
                )}
              />
            )}
            {/* 流式输出绿色呼吸点指示器 */}
            {streaming && (
              <span className="relative flex-shrink-0 size-2">
                <span className="absolute inset-0 rounded-full bg-green-500/60 animate-ping" />
                <span className="relative block size-2 rounded-full bg-green-500" />
              </span>
            )}
            {/* 置顶标记 */}
            {showPinIcon && (
              <Pin size={11} className="flex-shrink-0 text-primary/60" />
            )}
            <span className="truncate">{conversation.title}</span>
          </div>
        )}
      </div>

      {/* 操作按钮组（hover 时可见） */}
      <div className={cn(
        'flex items-center gap-0.5 flex-shrink-0 transition-all duration-100 overflow-hidden',
        hovered && !editing && !multiSelect ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin(conversation.id)
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors"
            >
              {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{isPinned ? '取消置顶' : '置顶对话'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                startEdit()
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors"
            >
              <Pencil size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">重命名</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleArchive(conversation.id)
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors"
            >
              {conversation.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{conversation.archived ? '取消归档' : '归档'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRequestDelete()
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">删除对话</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

// ===== Agent 会话列表项 =====

interface AgentSessionItemProps {
  session: AgentSessionMeta
  active: boolean
  selected: boolean
  multiSelect: boolean
  hovered: boolean
  running: boolean
  showPinIcon?: boolean
  onSelect: (event: React.MouseEvent<HTMLDivElement>) => void
  onRequestDelete: () => void
  onRequestMove: () => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function AgentSessionItem({
  session,
  active,
  selected,
  multiSelect,
  hovered,
  running,
  showPinIcon,
  onSelect,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleArchive,
  onMouseEnter,
  onMouseLeave,
}: AgentSessionItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const startEdit = (): void => {
    setEditTitle(session.title)
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  const saveTitle = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setEditing(false)
      return
    }
    await onRename(session.id, trimmed)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={(e) => {
        if (multiSelect) return
        e.stopPropagation()
        startEdit()
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-[7px] rounded-[10px] transition-colors duration-100 titlebar-no-drag text-left',
        (selected || active)
          ? 'session-item-selected bg-primary/10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'hover:bg-primary/5'
      )}
    >
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveTitle}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
            maxLength={100}
          />
        ) : (
          <div className={cn(
            'truncate text-[13px] leading-5 flex items-center gap-1.5',
            (active || selected) ? 'text-foreground' : 'text-foreground/80'
          )}>
            {multiSelect && (
              <span
                className={cn(
                  'size-3.5 rounded-[4px] border flex-shrink-0',
                  selected ? 'bg-primary border-primary' : 'border-foreground/30'
                )}
              />
            )}
            {running && (
              <span className="relative flex-shrink-0 size-4 flex items-center justify-center">
                <span className="absolute size-2 rounded-full bg-blue-500/60 animate-ping" />
                <span className="relative block size-2 rounded-full bg-blue-500" />
              </span>
            )}
            {showPinIcon && (
              <Pin size={11} className="flex-shrink-0 text-primary/60" />
            )}
            <span className="truncate">{session.title}</span>
          </div>
        )}
      </div>

      {/* 操作按钮组（hover 时可见） */}
      <div className={cn(
        'flex items-center gap-0.5 flex-shrink-0 transition-all duration-100 overflow-hidden',
        hovered && !editing && !multiSelect ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin(session.id)
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors"
            >
              {session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{session.pinned ? '取消置顶' : '置顶会话'}</TooltipContent>
        </Tooltip>
        {!running && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRequestMove()
                }}
                className="p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors"
              >
                <ArrowRightLeft size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">迁移到其他工作区</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                startEdit()
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors"
            >
              <Pencil size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">重命名</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleArchive(session.id)
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors"
            >
              {session.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{session.archived ? '取消归档' : '归档'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRequestDelete()
              }}
              className="p-1 rounded-md text-foreground/30 hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">删除会话</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
