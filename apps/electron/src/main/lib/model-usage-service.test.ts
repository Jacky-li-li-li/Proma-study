import { describe, expect, test } from 'bun:test'
import type { ChatMessage } from '@proma/shared'
import {
  toLocalDateKey,
  extractChatUsageRecord,
  extractAgentUsageRecordsFromEntry,
  buildModelUsageStatsFromRecords,
} from './model-usage-service'

describe('model-usage-service', () => {
  test('Chat: totalTokens 缺失时回退 inputTokens + outputTokens', () => {
    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'ok',
      createdAt: new Date(2026, 0, 10, 9, 0, 0).getTime(),
      model: 'gpt-5',
      usage: {
        inputTokens: 120,
        outputTokens: 30,
      },
    }

    const record = extractChatUsageRecord(msg)
    expect(record).not.toBeNull()
    expect(record?.tokens).toBe(150)
    expect(record?.model).toBe('gpt-5')
  })

  test('Agent: 仅统计 result.modelUsage，不统计 assistant 行', () => {
    const assistantEntry = {
      type: 'assistant',
      _createdAt: Date.now(),
      message: {
        usage: { input_tokens: 999, output_tokens: 1 },
      },
    }
    expect(extractAgentUsageRecordsFromEntry(assistantEntry)).toEqual([])

    const resultEntry = {
      type: 'result',
      _createdAt: new Date(2026, 0, 10, 10, 0, 0).getTime(),
      modelUsage: {
        'kimi-k2.5': {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 10,
        },
      },
    }
    const records = extractAgentUsageRecordsFromEntry(resultEntry)
    expect(records).toHaveLength(1)
    expect(records[0]?.tokens).toBe(160)
    expect(records[0]?.model).toBe('kimi-k2.5')
  })

  test('混合数据时 all/chat/agent 三种 scope 聚合正确', () => {
    const day1 = '2026-01-10'
    const day2 = '2026-01-11'

    const stats = buildModelUsageStatsFromRecords([
      { source: 'chat', date: day1, model: 'gpt-5', tokens: 100 },
      { source: 'chat', date: day1, model: 'gpt-5', tokens: 50 },
      { source: 'agent', date: day1, model: 'kimi-k2.5', tokens: 80 },
      { source: 'agent', date: day2, model: 'kimi-k2.5', tokens: 20 },
    ])

    expect(stats.scopes.chat.allTimeTotalTokens).toBe(150)
    expect(stats.scopes.agent.allTimeTotalTokens).toBe(100)
    expect(stats.scopes.all.allTimeTotalTokens).toBe(250)

    expect(stats.scopes.chat.daily).toHaveLength(1)
    expect(stats.scopes.chat.daily[0]).toMatchObject({
      date: day1,
      totalTokens: 150,
      models: { 'gpt-5': 150 },
    })

    expect(stats.scopes.agent.daily).toHaveLength(2)
    expect(stats.scopes.all.daily).toHaveLength(2)
    expect(stats.scopes.all.allTimeByModel).toMatchObject({
      'gpt-5': 150,
      'kimi-k2.5': 100,
    })
  })

  test('日分桶按本地日期边界区分', () => {
    const tsBeforeMidnight = new Date(2026, 0, 1, 23, 59, 59).getTime()
    const tsAfterMidnight = new Date(2026, 0, 2, 0, 0, 1).getTime()

    const day1 = toLocalDateKey(tsBeforeMidnight)
    const day2 = toLocalDateKey(tsAfterMidnight)

    expect(day1).toBe('2026-01-01')
    expect(day2).toBe('2026-01-02')
    expect(day1).not.toBe(day2)
  })
})

