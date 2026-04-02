/**
 * App Mode Atom - 应用模式状态
 *
 * - chat: 对话模式
 * - agent: Agent 模式（原 Flow）
 */

import { atomWithStorage } from 'jotai/utils'

export type AppMode = 'chat' | 'agent'

/** App 模式，自动持久化到 localStorage */
export const appModeAtom = atomWithStorage<AppMode>('proma-app-mode', 'chat')

/** Chat 模式最后一次打开的会话 ID */
export const lastOpenedConversationIdAtom = atomWithStorage<string | null>(
  'proma-last-opened-conversation-id',
  null,
)

/** Agent 模式最后一次打开的会话 ID */
export const lastOpenedAgentSessionIdAtom = atomWithStorage<string | null>(
  'proma-last-opened-agent-session-id',
  null,
)
