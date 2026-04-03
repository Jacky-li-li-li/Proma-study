export type FeishuResultRoute = 'feishu-session' | 'desktop-session'

export type FeishuBindingValidationError =
  | 'session-not-found'
  | 'session-chat-conflict'
  | 'workspace-session-mismatch'

interface FeishuBindingValidationInput {
  chatId: string
  targetWorkspaceId: string
  sessionExists: boolean
  sessionWorkspaceId?: string
  occupiedChatId?: string
}

export function shouldRejectIncomingMessage(agentActive: boolean, hasSessionBuffer: boolean): boolean {
  return agentActive || hasSessionBuffer
}

export function resolveFeishuResultRoute(hasSessionBuffer: boolean): FeishuResultRoute {
  return hasSessionBuffer ? 'feishu-session' : 'desktop-session'
}

export function validateFeishuBindingUpdate(
  input: FeishuBindingValidationInput,
): FeishuBindingValidationError | null {
  if (!input.sessionExists) {
    return 'session-not-found'
  }

  if (input.occupiedChatId && input.occupiedChatId !== input.chatId) {
    return 'session-chat-conflict'
  }

  if ((input.sessionWorkspaceId ?? '') !== input.targetWorkspaceId) {
    return 'workspace-session-mismatch'
  }

  return null
}
