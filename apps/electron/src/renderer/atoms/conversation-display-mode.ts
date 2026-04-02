/**
 * 会话显示模式状态管理
 *
 * 控制 Chat 模式消息气泡布局：
 * - left: 全部左对齐
 * - distributed: 用户在右侧、助手在左侧
 */

import { atom } from 'jotai'
import { DEFAULT_CONVERSATION_DISPLAY_MODE } from '../../types'
import type { ConversationDisplayMode } from '../../types'

/** 会话显示模式（全局） */
export const conversationDisplayModeAtom = atom<ConversationDisplayMode>(DEFAULT_CONVERSATION_DISPLAY_MODE)

/**
 * 从主进程加载会话显示模式设置
 */
export async function initializeConversationDisplayMode(
  setMode: (mode: ConversationDisplayMode) => void
): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    setMode(settings.conversationDisplayMode ?? DEFAULT_CONVERSATION_DISPLAY_MODE)
  } catch (error) {
    console.error('[会话显示模式] 初始化失败:', error)
  }
}

/**
 * 更新会话显示模式并持久化
 */
export async function updateConversationDisplayMode(
  mode: ConversationDisplayMode
): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ conversationDisplayMode: mode })
  } catch (error) {
    console.error('[会话显示模式] 更新设置失败:', error)
  }
}
