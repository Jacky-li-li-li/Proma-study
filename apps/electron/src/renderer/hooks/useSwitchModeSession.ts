import * as React from 'react'
import { useStore } from 'jotai'
import type { ConversationMeta, AgentSessionMeta } from '@proma/shared'
import {
  appModeAtom,
  lastOpenedAgentSessionIdAtom,
  lastOpenedConversationIdAtom,
  type AppMode,
} from '@/atoms/app-mode'
import { activeViewAtom } from '@/atoms/active-view'
import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { useCreateSession } from './useCreateSession'
import { requestScrollToLatest } from './useScrollPositionMemory'

function scheduleScrollToLatest(id: string, behavior: 'instant' | 'smooth' = 'instant'): void {
  if (typeof window === 'undefined') return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      requestScrollToLatest(id, behavior)
    })
  })
}

function activateChatSession(
  store: ReturnType<typeof useStore>,
  conversation: ConversationMeta,
): void {
  const tabs = store.get(tabsAtom)
  const layout = store.get(splitLayoutAtom)
  const result = openTab(tabs, layout, {
    type: 'chat',
    sessionId: conversation.id,
    title: conversation.title,
  })
  store.set(tabsAtom, result.tabs)
  store.set(splitLayoutAtom, result.layout)
  store.set(currentConversationIdAtom, conversation.id)
  store.set(lastOpenedConversationIdAtom, conversation.id)
  scheduleScrollToLatest(conversation.id, 'smooth')
}

function activateAgentSession(
  store: ReturnType<typeof useStore>,
  session: AgentSessionMeta,
): void {
  const tabs = store.get(tabsAtom)
  const layout = store.get(splitLayoutAtom)
  const result = openTab(tabs, layout, {
    type: 'agent',
    sessionId: session.id,
    title: session.title,
  })
  store.set(tabsAtom, result.tabs)
  store.set(splitLayoutAtom, result.layout)
  store.set(currentAgentSessionIdAtom, session.id)
  store.set(lastOpenedAgentSessionIdAtom, session.id)
  scheduleScrollToLatest(session.id, 'smooth')
}

interface SwitchModeSessionActions {
  switchToMode: (targetMode: AppMode) => Promise<void>
}

export function useSwitchModeSession(): SwitchModeSessionActions {
  const store = useStore()
  const { createChat, createAgent } = useCreateSession()

  const switchToMode = React.useCallback(async (targetMode: AppMode): Promise<void> => {
    store.set(appModeAtom, targetMode)
    store.set(activeViewAtom, 'conversations')

    if (targetMode === 'chat') {
      try {
        const conversations = await window.electronAPI.listConversations()
        store.set(conversationsAtom, conversations)
        const draftSessionIds = store.get(draftSessionIdsAtom)
        const visibleConversations = conversations.filter(
          (conversation) => !conversation.archived && !draftSessionIds.has(conversation.id),
        )
        const preferredConversationId =
          store.get(currentConversationIdAtom) ?? store.get(lastOpenedConversationIdAtom)
        const preferredConversation = preferredConversationId
          ? visibleConversations.find((conversation) => conversation.id === preferredConversationId) ?? null
          : null
        const targetConversation = preferredConversation ?? visibleConversations[0] ?? null
        if (targetConversation) {
          activateChatSession(store, targetConversation)
          return
        }
      } catch (error) {
        console.error('[模式切换] 加载 Chat 对话列表失败:', error)
      }

      const createdId = await createChat({ draft: true })
      if (createdId) scheduleScrollToLatest(createdId)
      return
    }

    try {
      const sessions = await window.electronAPI.listAgentSessions()
      store.set(agentSessionsAtom, sessions)
      const draftSessionIds = store.get(draftSessionIdsAtom)
      const visibleSessions = sessions.filter(
        (session) => !session.archived && !draftSessionIds.has(session.id),
      )
      const preferredSessionId =
        store.get(currentAgentSessionIdAtom) ?? store.get(lastOpenedAgentSessionIdAtom)
      const preferredSession = preferredSessionId
        ? visibleSessions.find((session) => session.id === preferredSessionId) ?? null
        : null
      const targetSession = preferredSession ?? visibleSessions[0] ?? null
      if (targetSession) {
        activateAgentSession(store, targetSession)
        return
      }
    } catch (error) {
      console.error('[模式切换] 加载 Agent 会话列表失败:', error)
    }

    const createdId = await createAgent({ draft: true })
    if (createdId) scheduleScrollToLatest(createdId)
  }, [store, createChat, createAgent])

  return { switchToMode }
}
