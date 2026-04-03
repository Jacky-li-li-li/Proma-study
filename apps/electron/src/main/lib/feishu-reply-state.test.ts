import { describe, expect, test } from 'bun:test'
import {
  deriveFeishuPhaseTransition,
  extractFeishuAssistantDeltas,
} from './feishu-reply-state'

describe('feishu-reply-state', () => {
  test('提取 assistant 增量：thinking/text/tool_use', () => {
    const deltas = extractFeishuAssistantDeltas([
      { type: 'thinking', thinking: '先分析问题。' },
      { type: 'tool_use', name: 'read_file' },
      { type: 'text', text: '这是最终回答。' },
      { type: 'tool_use', name: 'grep' },
      { type: 'thinking', thinking: '再校验一次。' },
    ])

    expect(deltas.thinkingDelta).toBe('先分析问题。再校验一次。')
    expect(deltas.resultDelta).toBe('这是最终回答。')
    expect(deltas.toolNames).toEqual(['read_file', 'grep'])
  })

  test('thinking 阶段收到 thinking 增量：继续刷新蓝卡', () => {
    const transition = deriveFeishuPhaseTransition('thinking', {
      thinkingDelta: '思考中...',
      resultDelta: '',
      toolNames: [],
    })

    expect(transition.nextPhase).toBe('thinking')
    expect(transition.shouldFlushThinking).toBe(true)
    expect(transition.shouldFinalizeThinking).toBe(false)
    expect(transition.shouldFlushResult).toBe(false)
  })

  test('thinking 阶段收到首个结果文本：完成 thinking 并开始结果流', () => {
    const transition = deriveFeishuPhaseTransition('thinking', {
      thinkingDelta: '',
      resultDelta: '开始输出结果',
      toolNames: [],
    })

    expect(transition.nextPhase).toBe('result')
    expect(transition.shouldFlushThinking).toBe(false)
    expect(transition.shouldFinalizeThinking).toBe(true)
    expect(transition.shouldFlushResult).toBe(true)
  })

  test('result 阶段继续收到结果文本：仅更新结果消息', () => {
    const transition = deriveFeishuPhaseTransition('result', {
      thinkingDelta: '',
      resultDelta: '补充输出',
      toolNames: [],
    })

    expect(transition.nextPhase).toBe('result')
    expect(transition.shouldFlushThinking).toBe(false)
    expect(transition.shouldFinalizeThinking).toBe(false)
    expect(transition.shouldFlushResult).toBe(true)
  })
})

