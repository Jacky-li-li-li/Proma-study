import type { McpServerEntry, McpTransportType } from '@proma/shared'

interface JsonObject {
  [key: string]: unknown
}

export interface McpImportParseResult {
  servers: Record<string, McpServerEntry>
  errors: string[]
  warnings: string[]
}

interface NormalizeEntryResult {
  entry?: McpServerEntry
  errors: string[]
  warnings: string[]
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toStringRecord(value: unknown, field: string, name: string): { data?: Record<string, string>; warnings: string[] } {
  const warnings: string[] = []
  if (!isJsonObject(value)) return { warnings }

  const data: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      data[key] = String(item)
    } else {
      warnings.push(`${name}: ${field}.${key} 不是字符串/数字/布尔，已忽略`)
    }
  }

  return { data: Object.keys(data).length > 0 ? data : undefined, warnings }
}

function parseArgs(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const args = value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
      .filter(Boolean)
    return args.length > 0 ? args : undefined
  }

  const raw = toTrimmedString(value)
  if (!raw) return undefined
  const args = raw.split(',').map((item) => item.trim()).filter(Boolean)
  return args.length > 0 ? args : undefined
}

function parseTimeout(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function inferType(raw: JsonObject): McpTransportType | undefined {
  const explicit = toTrimmedString(raw.type)
  if (explicit === 'stdio' || explicit === 'http' || explicit === 'sse') return explicit

  if (toTrimmedString(raw.command)) return 'stdio'
  if (toTrimmedString(raw.url)) return 'http'
  return undefined
}

function normalizeEntry(name: string, raw: JsonObject): NormalizeEntryResult {
  const warnings: string[] = []
  const errors: string[] = []

  const type = inferType(raw)
  if (!type) {
    errors.push(`${name}: 缺少有效 type，且无法从 command/url 推断`)
    return { errors, warnings }
  }

  const entry: McpServerEntry = {
    type,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
  }

  if (type === 'stdio') {
    const command = toTrimmedString(raw.command)
    if (!command) {
      errors.push(`${name}: stdio 类型缺少 command`)
      return { errors, warnings }
    }
    entry.command = command

    const args = parseArgs(raw.args)
    if (args) entry.args = args

    const env = toStringRecord(raw.env, 'env', name)
    if (env.data) entry.env = env.data
    warnings.push(...env.warnings)

    const timeout = parseTimeout(raw.timeout ?? raw.startup_timeout_sec)
    if (timeout) entry.timeout = timeout
  } else {
    const url = toTrimmedString(raw.url)
    if (!url) {
      errors.push(`${name}: ${type} 类型缺少 url`)
      return { errors, warnings }
    }
    entry.url = url

    const headers = toStringRecord(raw.headers, 'headers', name)
    if (headers.data) entry.headers = headers.data
    warnings.push(...headers.warnings)
  }

  if (typeof raw.isBuiltin === 'boolean') {
    entry.isBuiltin = raw.isBuiltin
  }

  return { entry, errors, warnings }
}

function extractServersObject(parsed: JsonObject): JsonObject | null {
  const mcpServers = parsed.mcpServers
  if (isJsonObject(mcpServers)) return mcpServers

  const servers = parsed.servers
  if (isJsonObject(servers)) return servers

  const entries = Object.entries(parsed)
  if (entries.length > 0 && entries.every(([, value]) => isJsonObject(value))) {
    return parsed
  }

  return null
}

export function parseMcpImportJson(rawText: string): McpImportParseResult {
  const result: McpImportParseResult = {
    servers: {},
    errors: [],
    warnings: [],
  }

  const text = rawText.trim()
  if (!text) {
    result.errors.push('请输入 JSON 内容')
    return result
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知解析错误'
    result.errors.push(`JSON 解析失败: ${message}`)
    return result
  }

  if (!isJsonObject(parsed)) {
    result.errors.push('JSON 顶层必须是对象')
    return result
  }

  const serversObject = extractServersObject(parsed)
  if (!serversObject) {
    result.errors.push('未找到可导入的服务器对象（支持 mcpServers 或 servers）')
    return result
  }

  for (const [name, rawEntry] of Object.entries(serversObject)) {
    const serverName = name.trim()
    if (!serverName) {
      result.errors.push('存在空服务器名称，已跳过')
      continue
    }

    if (!isJsonObject(rawEntry)) {
      result.errors.push(`${serverName}: 配置必须是对象`)
      continue
    }

    const normalized = normalizeEntry(serverName, rawEntry)
    if (normalized.entry) {
      result.servers[serverName] = normalized.entry
    }
    result.errors.push(...normalized.errors)
    result.warnings.push(...normalized.warnings)
  }

  if (Object.keys(result.servers).length === 0 && result.errors.length === 0) {
    result.errors.push('没有可导入的 MCP 服务器')
  }

  return result
}
