/**
 * 系统提示词管理服务
 *
 * 管理 Chat 模式的系统提示词 CRUD。
 * 存储在 ~/.proma/system-prompts.json
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getSystemPromptsPath } from './config-paths'
import {
  BUILTIN_DEFAULT_ID,
  BUILTIN_DEFAULT_PROMPT,
  BUILTIN_AGENT_ID,
  BUILTIN_AGENT_PROMPT,
} from '@proma/shared'
import type {
  SystemPrompt,
  SystemPromptConfig,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
} from '@proma/shared'

/** 默认配置 */
function getDefaultConfig(): SystemPromptConfig {
  return {
    prompts: [{ ...BUILTIN_DEFAULT_PROMPT }, { ...BUILTIN_AGENT_PROMPT }],
    defaultPromptId: BUILTIN_DEFAULT_ID,
    appendDateTimeAndUserName: true,
    agentPromptId: BUILTIN_AGENT_ID,
    agentPromptAppend: '',
  }
}

/** 迁移旧数据到新结构 */
function migrateIfNeeded(data: SystemPromptConfig): SystemPromptConfig {
  let migrated = false

  // 确保内置 Agent 提示词存在
  const builtinAgentIndex = data.prompts.findIndex((p) => p.id === BUILTIN_AGENT_ID)
  if (builtinAgentIndex === -1) {
    data.prompts.push({ ...BUILTIN_AGENT_PROMPT })
    migrated = true
  } else {
    // 始终用源码中的最新内容覆盖
    data.prompts[builtinAgentIndex] = { ...BUILTIN_AGENT_PROMPT }
  }

  // 迁移 agentPromptAppend 到 prompts 数组
  if (data.agentPromptAppend?.trim()) {
    const migratedPrompt: SystemPrompt = {
      id: randomUUID(),
      name: 'Agent 自定义提示词（已迁移）',
      content: data.agentPromptAppend,
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageMode: 'agent',
    }
    data.prompts.push(migratedPrompt)
    data.agentPromptId = migratedPrompt.id
    data.agentPromptAppend = ''
    migrated = true
    console.log('[系统提示词] 已迁移 agentPromptAppend 到 prompts 数组')
  }

  // 初始化 agentPromptId
  if (!data.agentPromptId) {
    data.agentPromptId = BUILTIN_AGENT_ID
  }

  if (migrated) {
    console.log('[系统提示词] 数据迁移完成')
  }

  return data
}

/** 读取配置文件 */
function readConfig(): SystemPromptConfig {
  const filePath = getSystemPromptsPath()

  if (!existsSync(filePath)) {
    return getDefaultConfig()
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as SystemPromptConfig

    // 确保内置默认提示词始终存在，且内容与源码保持同步
    const builtinIndex = data.prompts.findIndex((p) => p.id === BUILTIN_DEFAULT_ID)
    if (builtinIndex === -1) {
      data.prompts.unshift({ ...BUILTIN_DEFAULT_PROMPT })
    } else {
      // 始终用源码中的最新内容覆盖，防止文件中残留旧版本
      data.prompts[builtinIndex] = { ...BUILTIN_DEFAULT_PROMPT }
    }

    // 为没有 usageMode 的已有提示词设置默认值
    let needsMigration = false
    for (const prompt of data.prompts) {
      if (prompt.usageMode === undefined) {
        prompt.usageMode = 'both'
        needsMigration = true
      }
    }
    if (needsMigration) {
      console.log('[系统提示词] 已为旧提示词设置默认 usageMode')
    }

    // 执行迁移
    const migratedData = migrateIfNeeded(data)

    return {
      prompts: migratedData.prompts,
      defaultPromptId: migratedData.defaultPromptId,
      appendDateTimeAndUserName: migratedData.appendDateTimeAndUserName ?? true,
      agentPromptId: migratedData.agentPromptId ?? BUILTIN_AGENT_ID,
      agentPromptAppend: migratedData.agentPromptAppend ?? '',
    }
  } catch (error) {
    console.error('[系统提示词] 读取配置失败:', error)
    return getDefaultConfig()
  }
}

/** 写入配置文件 */
function writeConfig(config: SystemPromptConfig): void {
  const filePath = getSystemPromptsPath()

  try {
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[系统提示词] 写入配置失败:', error)
    throw new Error('写入系统提示词配置失败')
  }
}

/**
 * 获取系统提示词配置
 */
export function getSystemPromptConfig(): SystemPromptConfig {
  return readConfig()
}

/**
 * 创建自定义提示词
 */
export function createSystemPrompt(input: SystemPromptCreateInput): SystemPrompt {
  const config = readConfig()
  const now = Date.now()

  const prompt: SystemPrompt = {
    id: randomUUID(),
    name: input.name,
    content: input.content,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
    usageMode: input.usageMode ?? 'both',
  }

  config.prompts.push(prompt)
  writeConfig(config)
  console.log(`[系统提示词] 已创建: ${prompt.name} (${prompt.id})`)
  return prompt
}

/**
 * 更新提示词
 *
 * 内置提示词不可编辑。
 */
export function updateSystemPrompt(id: string, input: SystemPromptUpdateInput): SystemPrompt {
  const config = readConfig()
  const index = config.prompts.findIndex((p) => p.id === id)

  if (index === -1) {
    throw new Error(`提示词不存在: ${id}`)
  }

  const prompt = config.prompts[index]!
  if (prompt.isBuiltin) {
    throw new Error('内置提示词不可编辑')
  }

  if (input.name !== undefined) prompt.name = input.name
  if (input.content !== undefined) prompt.content = input.content
  prompt.updatedAt = Date.now()

  writeConfig(config)
  console.log(`[系统提示词] 已更新: ${prompt.name} (${prompt.id})`)
  return prompt
}

/**
 * 删除提示词
 *
 * 内置提示词不可删除。
 * 如果被删除的是当前默认提示词，重置为内置默认。
 * 如果被删除的是当前 Agent 选中的提示词，重置为内置 Agent 提示词。
 */
export function deleteSystemPrompt(id: string): void {
  const config = readConfig()
  const prompt = config.prompts.find((p) => p.id === id)

  if (!prompt) {
    throw new Error(`提示词不存在: ${id}`)
  }

  if (prompt.isBuiltin) {
    throw new Error('内置提示词不可删除')
  }

  config.prompts = config.prompts.filter((p) => p.id !== id)

  // 如果被删除的是默认提示词，重置为内置默认
  if (config.defaultPromptId === id) {
    config.defaultPromptId = BUILTIN_DEFAULT_ID
  }

  // 如果被删除的是 Agent 当前选中的提示词，重置为内置 Agent 提示词
  if (config.agentPromptId === id) {
    config.agentPromptId = BUILTIN_AGENT_ID
  }

  writeConfig(config)
  console.log(`[系统提示词] 已删除: ${prompt.name} (${id})`)
}

/**
 * 更新追加日期时间和用户名开关
 */
export function updateAppendSetting(enabled: boolean): void {
  const config = readConfig()
  config.appendDateTimeAndUserName = enabled
  writeConfig(config)
  console.log(`[系统提示词] 追加设置已更新: ${enabled}`)
}

/**
 * 设置默认提示词
 *
 * 传入 null 清除自定义默认（回退到内置默认）。
 */
export function setDefaultPrompt(id: string | null): void {
  const config = readConfig()

  if (id !== null) {
    const exists = config.prompts.some((p) => p.id === id)
    if (!exists) {
      throw new Error(`提示词不存在: ${id}`)
    }
  }

  config.defaultPromptId = id ?? BUILTIN_DEFAULT_ID
  writeConfig(config)
  console.log(`[系统提示词] 默认提示词已设置: ${config.defaultPromptId}`)
}

/**
 * 获取 Agent 附加提示词
 */
export function getAgentPromptAppend(): string {
  return readConfig().agentPromptAppend
}

/**
 * 更新 Agent 附加提示词
 */
export function updateAgentPromptAppend(content: string): void {
  const config = readConfig()
  config.agentPromptAppend = content
  writeConfig(config)
  console.log(`[系统提示词] Agent 附加提示词已更新（长度: ${content.length}）`)
}

/**
 * 设置 Agent 当前选中的提示词
 */
export function updateAgentPromptId(id: string): void {
  const config = readConfig()
  const prompt = config.prompts.find((p) => p.id === id)
  if (!prompt) {
    throw new Error(`提示词不存在: ${id}`)
  }
  config.agentPromptId = id
  writeConfig(config)
  console.log(`[系统提示词] Agent 提示词已设置为: ${prompt.name} (${id})`)
}
