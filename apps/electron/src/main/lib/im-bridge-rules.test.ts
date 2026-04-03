import { describe, expect, test } from 'bun:test'
import {
  resolveFeishuResultRoute,
  shouldRejectIncomingMessage,
  validateFeishuBindingUpdate,
} from './im-bridge-rules'

describe('im-bridge-rules', () => {
  test('飞书 result 路由：有缓冲走飞书，无缓冲走桌面通知', () => {
    expect(resolveFeishuResultRoute(true)).toBe('feishu-session')
    expect(resolveFeishuResultRoute(false)).toBe('desktop-session')
  })

  test('绑定冲突：会话已被其他 chat 绑定时拒绝更新', () => {
    const result = validateFeishuBindingUpdate({
      chatId: 'chat-a',
      targetWorkspaceId: 'ws-1',
      sessionExists: true,
      sessionWorkspaceId: 'ws-1',
      occupiedChatId: 'chat-b',
    })
    expect(result).toBe('session-chat-conflict')
  })

  test('一致性校验：session/workspace 不匹配时拒绝更新', () => {
    const result = validateFeishuBindingUpdate({
      chatId: 'chat-a',
      targetWorkspaceId: 'ws-2',
      sessionExists: true,
      sessionWorkspaceId: 'ws-1',
      occupiedChatId: 'chat-a',
    })
    expect(result).toBe('workspace-session-mismatch')
  })

  test('运行中重入：active 或有缓冲都应拒绝', () => {
    expect(shouldRejectIncomingMessage(true, false)).toBe(true)
    expect(shouldRejectIncomingMessage(false, true)).toBe(true)
    expect(shouldRejectIncomingMessage(false, false)).toBe(false)
  })
})
