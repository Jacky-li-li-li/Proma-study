/**
 * 飞书回复状态机（Thinking 卡片 + 结果文本流）
 */

export type FeishuReplyPhase = 'thinking' | 'result' | 'completed' | 'error'

export interface FeishuAssistantDeltas {
  thinkingDelta: string
  resultDelta: string
  toolNames: string[]
}

export interface FeishuReplyPhaseTransition {
  nextPhase: FeishuReplyPhase
  shouldFlushThinking: boolean
  shouldFinalizeThinking: boolean
  shouldFlushResult: boolean
}

type AssistantBlock = {
  type?: string
  text?: string
  thinking?: string
  name?: string
}

/**
 * 从 assistant content blocks 提取 thinking / result / tool_use 增量
 */
export function extractFeishuAssistantDeltas(blocks: AssistantBlock[]): FeishuAssistantDeltas {
  let thinkingDelta = ''
  let resultDelta = ''
  const toolNames: string[] = []

  for (const block of blocks) {
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      thinkingDelta += block.thinking
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      resultDelta += block.text
      continue
    }
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      toolNames.push(block.name)
    }
  }

  return { thinkingDelta, resultDelta, toolNames }
}

/**
 * 根据当前 phase 和本次 assistant 增量，推导本轮需要执行的刷新动作
 */
export function deriveFeishuPhaseTransition(
  currentPhase: FeishuReplyPhase,
  deltas: FeishuAssistantDeltas,
): FeishuReplyPhaseTransition {
  const hasThinking = deltas.thinkingDelta.length > 0
  const hasResult = deltas.resultDelta.length > 0

  if (currentPhase === 'thinking') {
    if (hasResult) {
      // 首个结果文本到达：thinking 完成并进入结果流
      return {
        nextPhase: 'result',
        shouldFlushThinking: false,
        shouldFinalizeThinking: true,
        shouldFlushResult: true,
      }
    }

    return {
      nextPhase: 'thinking',
      shouldFlushThinking: hasThinking,
      shouldFinalizeThinking: false,
      shouldFlushResult: false,
    }
  }

  if (currentPhase === 'result') {
    return {
      nextPhase: 'result',
      shouldFlushThinking: false,
      shouldFinalizeThinking: false,
      shouldFlushResult: hasResult,
    }
  }

  return {
    nextPhase: currentPhase,
    shouldFlushThinking: false,
    shouldFinalizeThinking: false,
    shouldFlushResult: false,
  }
}

