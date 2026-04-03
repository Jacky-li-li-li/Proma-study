import { describe, expect, test } from 'bun:test'
import {
  FEISHU_THINKING_COLLAPSE_LINES,
  buildErrorCard,
  buildThinkingCompletedCard,
  buildThinkingInProgressCard,
} from './feishu-message'

describe('feishu-message builders', () => {
  test('Thinking 中卡片为蓝色并携带工作区副标题与耗时', () => {
    const card = buildThinkingInProgressCard({
      workspaceName: 'Project Alpha',
      thinkingText: '分析需求...\n检索上下文...',
      durationSeconds: 12.4,
    }) as {
      config?: { update_multi?: boolean }
      header?: { title?: { content?: string }; subtitle?: { content?: string }; template?: string }
      elements?: Array<{ tag?: string; text?: { content?: string }; elements?: Array<{ content?: string }> }>
    }

    expect(card.config?.update_multi).toBe(true)
    expect(card.header?.template).toBe('blue')
    expect(card.header?.title?.content).toBe('思考中')
    expect(card.header?.subtitle?.content).toBe('工作区：Project Alpha')
    expect(card.elements?.[0]?.tag).toBe('div')
    expect(card.elements?.[0]?.text?.content).toContain('分析需求')
    expect(card.elements?.[2]?.elements?.[0]?.content).toBe('耗时：12s')
  })

  test('Thinking 完成卡片为绿色并默认折叠', () => {
    const card = buildThinkingCompletedCard({
      workspaceName: 'Project Alpha',
      thinkingText: '这是一段较长的思考内容',
      durationSeconds: 9.6,
    }) as {
      header?: { title?: { content?: string }; template?: string }
      elements?: Array<{ text?: { lines?: number } }>
    }

    expect(card.header?.template).toBe('green')
    expect(card.header?.title?.content).toBe('思考完成')
    expect(card.elements?.[0]?.text?.lines).toBe(FEISHU_THINKING_COLLAPSE_LINES)
  })

  test('错误卡片使用工作区错误标题和红色模板', () => {
    const card = buildErrorCard('工作区 A', '**请求失败**: 网络超时') as {
      header?: { title?: { content?: string }; template?: string }
      elements?: Array<{ content?: string }>
    }

    expect(card.header?.template).toBe('red')
    expect(card.header?.title?.content).toBe('工作区 A 错误')
    expect(card.elements?.[0]?.content).toBe('**请求失败**: 网络超时')
  })
})

