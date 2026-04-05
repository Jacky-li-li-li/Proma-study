/**
 * WelcomeView — 主区域空状态启动器
 *
 * 当没有打开任何标签页时：
 * 1. 优先复用现有会话（打开最近的一个）
 * 2. 没有现有会话时，创建一个 draft 会话（不在侧边栏显示）
 *
 * 这样用户直接看到完整的 ChatView/AgentView（含全功能输入框），
 * 发送第一条消息后 draft 标记自动移除，会话出现在侧边栏。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { Loader2 } from 'lucide-react'
import { appModeAtom, lastOpenedConversationIdAtom, lastOpenedAgentSessionIdAtom } from '@/atoms/app-mode'
import { conversationsAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom, currentAgentWorkspaceIdAtom, agentSettingsReadyAtom } from '@/atoms/agent-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'

type DraftChatCreator = (options?: { draft?: boolean }) => Promise<string | undefined>
type DraftAgentCreator = (options?: { draft?: boolean }) => Promise<string | undefined>

let chatDraftCreationInFlight: Promise<string | undefined> | null = null
const agentDraftCreationInFlight = new Map<string, Promise<string | undefined>>()

function createChatDraftOnce(createChat: DraftChatCreator): Promise<string | undefined> {
  if (chatDraftCreationInFlight) return chatDraftCreationInFlight
  chatDraftCreationInFlight = createChat({ draft: true }).finally(() => {
    chatDraftCreationInFlight = null
  })
  return chatDraftCreationInFlight
}

function createAgentDraftOnce(
  workspaceKey: string,
  createAgent: DraftAgentCreator,
): Promise<string | undefined> {
  const inFlight = agentDraftCreationInFlight.get(workspaceKey)
  if (inFlight) return inFlight
  const promise = createAgent({ draft: true }).finally(() => {
    agentDraftCreationInFlight.delete(workspaceKey)
  })
  agentDraftCreationInFlight.set(workspaceKey, promise)
  return promise
}

export function WelcomeView(): React.ReactElement {
  const store = useStore()
  const mode = useAtomValue(appModeAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const agentSettingsReady = useAtomValue(agentSettingsReadyAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const lastOpenedConversationId = useAtomValue(lastOpenedConversationIdAtom)
  const lastOpenedAgentSessionId = useAtomValue(lastOpenedAgentSessionIdAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setTabs = useSetAtom(tabsAtom)
  const setLayout = useSetAtom(splitLayoutAtom)
  const { createChat, createAgent } = useCreateSession()
  const initRef = React.useRef(false)

  React.useEffect(() => {
    if (initRef.current) return
    // Agent 模式需等待 settings 就绪（workspaceId 等异步加载完成）
    if (mode === 'agent' && !agentSettingsReady) return
    initRef.current = true
    let cancelled = false

    const bootstrap = async (): Promise<void> => {
      try {
        // 组件仅在没有标签页时显示，若期间已有标签则不再处理。
        if (store.get(tabsAtom).length > 0) return

        if (mode === 'chat') {
          // 先实时拉取会话列表，避免初始化竞态把”尚未加载”误判为”没有会话”。
          const latestConversations = await window.electronAPI.listConversations()
          if (cancelled) return
          setConversations(latestConversations)

          // 优先恢复上次打开的会话，其次取第一个可用会话
          const preferred = lastOpenedConversationId
            ? latestConversations.find(
                (c) => c.id === lastOpenedConversationId && !c.archived && !draftSessionIds.has(c.id),
              )
            : null
          const existing = preferred ?? latestConversations.find((c) => !c.archived && !draftSessionIds.has(c.id))
          if (existing) {
            if (store.get(tabsAtom).length > 0) return
            const tabs = store.get(tabsAtom)
            const layout = store.get(splitLayoutAtom)
            const result = openTab(tabs, layout, {
              type: 'chat',
              sessionId: existing.id,
              title: existing.title,
            })
            setTabs(result.tabs)
            setLayout(result.layout)
            return
          }

          if (store.get(tabsAtom).length > 0) return
          await createChatDraftOnce(createChat)
          return
        }

        // Agent 模式：先实时拉取会话列表，再按当前工作区判空。
        const latestSessions = await window.electronAPI.listAgentSessions()
        if (cancelled) return
        setAgentSessions(latestSessions)

        // 优先恢复上次打开的会话，其次取第一个可用会话
        const preferred = lastOpenedAgentSessionId
          ? latestSessions.find(
              (s) =>
                s.id === lastOpenedAgentSessionId &&
                !s.archived &&
                s.workspaceId === currentWorkspaceId &&
                !draftSessionIds.has(s.id),
            )
          : null
        const existing = preferred ?? latestSessions.find(
          (s) => !s.archived && s.workspaceId === currentWorkspaceId && !draftSessionIds.has(s.id),
        )
        if (existing) {
          if (store.get(tabsAtom).length > 0) return
          const tabs = store.get(tabsAtom)
          const layout = store.get(splitLayoutAtom)
          const result = openTab(tabs, layout, {
            type: 'agent',
            sessionId: existing.id,
            title: existing.title,
          })
          setTabs(result.tabs)
          setLayout(result.layout)
          return
        }

        if (store.get(tabsAtom).length > 0) return
        const workspaceKey = currentWorkspaceId ?? '__no_workspace__'
        await createAgentDraftOnce(workspaceKey, createAgent)
      } catch (error) {
        console.error('[WelcomeView] 初始化会话失败:', error)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [
    mode,
    currentWorkspaceId,
    agentSettingsReady,
    createChat,
    createAgent,
    draftSessionIds,
    lastOpenedConversationId,
    lastOpenedAgentSessionId,
    setConversations,
    setAgentSessions,
    setTabs,
    setLayout,
    store,
  ])

  // 短暂的过渡状态（通常几十毫秒内就会被 SplitContainer 替换）
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
    </div>
  )
}
