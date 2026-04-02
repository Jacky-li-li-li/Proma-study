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
import { useAtom, useSetAtom, useStore } from 'jotai'
import { Loader2 } from 'lucide-react'
import { appModeAtom } from '@/atoms/app-mode'
import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'

declare global {
  interface Window {
    __promaWelcomeBootstrapPromise?: Promise<void> | null
  }
}

export function WelcomeView(): React.ReactElement {
  const [mode] = useAtom(appModeAtom)
  const [currentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const [draftSessionIds] = useAtom(draftSessionIdsAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const store = useStore()
  const { createChat, createAgent } = useCreateSession()

  React.useEffect(() => {
    if (window.__promaWelcomeBootstrapPromise) return

    const bootstrapPromise = (async () => {
      if (mode === 'agent') {
        const sessions = await window.electronAPI.listAgentSessions()
        setAgentSessions(sessions)

        const latestSession = sessions.find(
          (s) => !s.archived && s.workspaceId === currentWorkspaceId && !draftSessionIds.has(s.id),
        )
        if (latestSession) {
          const result = openTab(store.get(tabsAtom), store.get(splitLayoutAtom), {
            type: 'agent',
            sessionId: latestSession.id,
            title: latestSession.title,
          })
          setTabs(result.tabs)
          setLayout(result.layout)
          setCurrentAgentSessionId(latestSession.id)
          setActiveView('conversations')
          return
        }

        await createAgent({ draft: true })
        return
      }

      const conversations = await window.electronAPI.listConversations()
      setConversations(conversations)

      const latestConversation = conversations.find((c) => !c.archived && !draftSessionIds.has(c.id))
      if (latestConversation) {
        const result = openTab(store.get(tabsAtom), store.get(splitLayoutAtom), {
          type: 'chat',
          sessionId: latestConversation.id,
          title: latestConversation.title,
        })
        setTabs(result.tabs)
        setLayout(result.layout)
        setCurrentConversationId(latestConversation.id)
        setActiveView('conversations')
        return
      }

      await createChat({ draft: true })
    })().finally(() => {
      window.__promaWelcomeBootstrapPromise = null
    })

    window.__promaWelcomeBootstrapPromise = bootstrapPromise
  }, [
    mode,
    currentWorkspaceId,
    draftSessionIds,
    tabs,
    layout,
    store,
    setTabs,
    setLayout,
    setConversations,
    setCurrentConversationId,
    setAgentSessions,
    setCurrentAgentSessionId,
    setActiveView,
    createChat,
    createAgent,
  ])

  // 短暂的过渡状态（通常几十毫秒内就会被 SplitContainer 替换）
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
    </div>
  )
}
