/**
 * 模型用量统计服务
 *
 * 读取本地 JSONL 历史数据，聚合为按天/按模型的 token 使用统计。
 * 数据来源：
 * - Chat: ~/.proma/conversations/*.jsonl（assistant 消息 usage）
 * - Agent: ~/.proma/agent-sessions/*.jsonl（result 消息 modelUsage）
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, ModelUsageStats, UsageScope, UsageScopeStats } from '@proma/shared'
import { getConversationsDir, getAgentSessionsDir } from './config-paths'

interface UsageRecord {
  source: 'chat' | 'agent'
  date: string
  model: string
  tokens: number
}

const UNKNOWN_MODEL = '未知模型'

function asPositiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function toLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeModelName(model: unknown): string {
  if (typeof model !== 'string') return UNKNOWN_MODEL
  const trimmed = model.trim()
  return trimmed.length > 0 ? trimmed : UNKNOWN_MODEL
}

function listJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(dir, name))
  } catch (error) {
    console.warn(`[模型用量] 读取目录失败: ${dir}`, error)
    return []
  }
}

function readJsonLines(filePath: string): unknown[] {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim().length > 0)
    const parsed: unknown[] = []
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line))
      } catch {
        // 跳过坏行，保持统计健壮性
      }
    }
    return parsed
  } catch (error) {
    console.warn(`[模型用量] 读取文件失败: ${filePath}`, error)
    return []
  }
}

export function extractChatUsageRecord(message: ChatMessage): UsageRecord | null {
  if (message.role !== 'assistant') return null
  if (typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt)) return null
  if (!message.usage) return null

  const usage = message.usage
  let totalTokens = asPositiveNumber(usage.totalTokens)
  if (totalTokens <= 0) {
    totalTokens = asPositiveNumber(usage.inputTokens) + asPositiveNumber(usage.outputTokens)
  }
  if (totalTokens <= 0) return null

  return {
    source: 'chat',
    date: toLocalDateKey(message.createdAt),
    model: normalizeModelName(message.model),
    tokens: totalTokens,
  }
}

export function extractAgentUsageRecordsFromEntry(entry: unknown): UsageRecord[] {
  if (!entry || typeof entry !== 'object') return []

  const payload = entry as Record<string, unknown>
  if (payload.type !== 'result') return []

  const createdAt = asPositiveNumber(payload._createdAt)
  if (createdAt <= 0) return []

  const date = toLocalDateKey(createdAt)
  const records: UsageRecord[] = []

  const modelUsage = payload.modelUsage
  if (modelUsage && typeof modelUsage === 'object') {
    for (const [model, detail] of Object.entries(modelUsage as Record<string, unknown>)) {
      if (!detail || typeof detail !== 'object') continue
      const modelDetail = detail as Record<string, unknown>
      const totalTokens =
        asPositiveNumber(modelDetail.inputTokens)
        + asPositiveNumber(modelDetail.outputTokens)
        + asPositiveNumber(modelDetail.cacheReadInputTokens)
        + asPositiveNumber(modelDetail.cacheCreationInputTokens)
      if (totalTokens <= 0) continue
      records.push({
        source: 'agent',
        date,
        model: normalizeModelName(model),
        tokens: totalTokens,
      })
    }
  }

  if (records.length > 0) return records

  // 兜底：旧/异常 result 格式（无 modelUsage）时按 usage 聚合到单模型
  const usage = payload.usage
  if (!usage || typeof usage !== 'object') return []
  const usageObj = usage as Record<string, unknown>
  const fallbackTotal =
    asPositiveNumber(usageObj.input_tokens)
    + asPositiveNumber(usageObj.output_tokens)
    + asPositiveNumber(usageObj.cache_read_input_tokens)
    + asPositiveNumber(usageObj.cache_creation_input_tokens)
  if (fallbackTotal <= 0) return []

  return [{
    source: 'agent',
    date,
    model: normalizeModelName(payload.model),
    tokens: fallbackTotal,
  }]
}

function buildScopeStats(records: UsageRecord[]): UsageScopeStats {
  const byDate = new Map<string, Map<string, number>>()
  const byModel = new Map<string, number>()
  let allTimeTotalTokens = 0

  for (const record of records) {
    allTimeTotalTokens += record.tokens
    byModel.set(record.model, (byModel.get(record.model) ?? 0) + record.tokens)

    const dayMap = byDate.get(record.date) ?? new Map<string, number>()
    dayMap.set(record.model, (dayMap.get(record.model) ?? 0) + record.tokens)
    byDate.set(record.date, dayMap)
  }

  const daily = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, models]) => {
      const modelEntries = Array.from(models.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      const modelObject = Object.fromEntries(modelEntries)
      const totalTokens = modelEntries.reduce((sum, [, value]) => sum + value, 0)
      return { date, models: modelObject, totalTokens }
    })

  const allTimeByModel = Object.fromEntries(
    Array.from(byModel.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  )

  return {
    daily,
    allTimeTotalTokens,
    allTimeByModel,
  }
}

export function buildModelUsageStatsFromRecords(records: UsageRecord[]): ModelUsageStats {
  const chatRecords = records.filter((record) => record.source === 'chat')
  const agentRecords = records.filter((record) => record.source === 'agent')

  const scopes: Record<UsageScope, UsageScopeStats> = {
    all: buildScopeStats(records),
    chat: buildScopeStats(chatRecords),
    agent: buildScopeStats(agentRecords),
  }

  return {
    generatedAt: Date.now(),
    scopes,
  }
}

export function getModelUsageStats(): ModelUsageStats {
  const records: UsageRecord[] = []

  const conversationFiles = listJsonlFiles(getConversationsDir())
  for (const filePath of conversationFiles) {
    const messages = readJsonLines(filePath)
    for (const line of messages) {
      const message = line as ChatMessage
      const record = extractChatUsageRecord(message)
      if (record) records.push(record)
    }
  }

  const agentFiles = listJsonlFiles(getAgentSessionsDir())
  for (const filePath of agentFiles) {
    const entries = readJsonLines(filePath)
    for (const entry of entries) {
      records.push(...extractAgentUsageRecordsFromEntry(entry))
    }
  }

  return buildModelUsageStatsFromRecords(records)
}

