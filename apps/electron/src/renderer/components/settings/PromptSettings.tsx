/**
 * PromptSettings - 系统提示词管理设置页
 *
 * 支持 Chat / Agent Tab 切换：
 * - Chat：提示词列表（选择/新建/删除/设为默认）+ 编辑区 + 增强选项
 * - Agent：编辑自定义提示词（替换内置 Agent 提示词）
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Plus, Trash2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
} from './primitives'
import {
  promptConfigAtom,
  selectedPromptIdAtom,
  defaultPromptIdAtom,
  agentPromptIdAtom,
} from '@/atoms/system-prompt-atoms'
import type { SystemPrompt, SystemPromptCreateInput, SystemPromptUpdateInput } from '@proma/shared'

/** 防抖保存延迟 (ms) */
const DEBOUNCE_DELAY = 500

type PromptTab = 'chat' | 'agent'

export function PromptSettings(): React.ReactElement {
  const [config, setConfig] = useAtom(promptConfigAtom)
  const [selectedId, setSelectedId] = useAtom(selectedPromptIdAtom)
  const [agentSelectedId, setAgentSelectedId] = useAtom(agentPromptIdAtom)
  const defaultPromptId = useAtomValue(defaultPromptIdAtom)
  const [activeTab, setActiveTab] = React.useState<PromptTab>('chat')

  const [editName, setEditName] = React.useState('')
  const [editContent, setEditContent] = React.useState('')
  const [agentEditName, setAgentEditName] = React.useState('')
  const [agentEditContent, setAgentEditContent] = React.useState('')
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)

  const chatDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 当前选中的 Agent 提示词 */
  const selectedAgentPrompt = React.useMemo(
    () => config.prompts.find((p) => p.id === agentSelectedId),
    [config.prompts, agentSelectedId]
  )

  /** 当前选中的提示词 */
  const selectedPrompt = React.useMemo(
    () => config.prompts.find((p) => p.id === selectedId),
    [config.prompts, selectedId]
  )

  /** 初始加载配置 */
  React.useEffect(() => {
    window.electronAPI.getSystemPromptConfig().then((cfg) => {
      setConfig(cfg)
      // 如果当前选中的 Agent 提示词不在列表中（迁移等原因），使用后端默认值
      if (!cfg.prompts.some((p) => p.id === agentSelectedId)) {
        setAgentSelectedId(cfg.agentPromptId ?? 'builtin-agent-default')
      }
    }).catch(console.error)
  }, [setConfig])

  /** 选中提示词变化时，同步编辑字段 */
  React.useEffect(() => {
    if (selectedPrompt) {
      setEditName(selectedPrompt.name)
      setEditContent(selectedPrompt.content)
    }
  }, [selectedPrompt])

  /** Agent 选中提示词变化时同步编辑字段 */
  React.useEffect(() => {
    if (selectedAgentPrompt) {
      setAgentEditName(selectedAgentPrompt.name)
      setAgentEditContent(selectedAgentPrompt.content)
    }
  }, [selectedAgentPrompt])

  /** 组件卸载时清理防抖定时器 */
  React.useEffect(() => {
    return () => {
      if (chatDebounceRef.current) clearTimeout(chatDebounceRef.current)
      if (agentDebounceRef.current) clearTimeout(agentDebounceRef.current)
    }
  }, [])

  /** 选中提示词 */
  const handleSelect = (id: string): void => {
    setSelectedId(id)
  }

  /** 新建提示词 */
  const handleCreate = async (): Promise<void> => {
    const input: SystemPromptCreateInput = {
      name: '新提示词',
      content: '',
      usageMode: 'chat',
    }
    try {
      const created = await window.electronAPI.createSystemPrompt(input)
      setConfig((prev) => ({
        ...prev,
        prompts: [...prev.prompts, created],
      }))
      setSelectedId(created.id)
    } catch (error) {
      console.error('[提示词设置] 创建失败:', error)
    }
  }

  /** 删除提示词 */
  const handleDelete = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.deleteSystemPrompt(id)
      setConfig((prev) => {
        const newPrompts = prev.prompts.filter((p) => p.id !== id)
        const newDefaultId = prev.defaultPromptId === id ? 'builtin-default' : prev.defaultPromptId
        return { ...prev, prompts: newPrompts, defaultPromptId: newDefaultId }
      })
      // 如果删除的是当前选中的，切换到内置默认
      if (selectedId === id) {
        setSelectedId('builtin-default')
      }
    } catch (error) {
      console.error('[提示词设置] 删除失败:', error)
    }
  }

  /** 设为默认提示词 */
  const handleSetDefault = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.setDefaultPrompt(id)
      setConfig((prev) => ({ ...prev, defaultPromptId: id }))
    } catch (error) {
      console.error('[提示词设置] 设置默认失败:', error)
    }
  }

  /** 防抖自动保存 */
  const debounceSave = React.useCallback(
    (id: string, input: SystemPromptUpdateInput): void => {
      if (chatDebounceRef.current) clearTimeout(chatDebounceRef.current)
      chatDebounceRef.current = setTimeout(async () => {
        try {
          const updated = await window.electronAPI.updateSystemPrompt(id, input)
          setConfig((prev) => ({
            ...prev,
            prompts: prev.prompts.map((p) => (p.id === updated.id ? updated : p)),
          }))
        } catch (error) {
          console.error('[提示词设置] 保存失败:', error)
        }
      }, DEBOUNCE_DELAY)
    },
    [setConfig]
  )

  /** Agent 提示词防抖保存 */
  const debounceSaveAgentPrompt = React.useCallback(
    (id: string, input: SystemPromptUpdateInput): void => {
      if (agentDebounceRef.current) clearTimeout(agentDebounceRef.current)
      agentDebounceRef.current = setTimeout(async () => {
        try {
          const updated = await window.electronAPI.updateSystemPrompt(id, input)
          setConfig((prev) => ({
            ...prev,
            prompts: prev.prompts.map((p) => (p.id === updated.id ? updated : p)),
          }))
        } catch (error) {
          console.error('[提示词设置] 保存 Agent 提示词失败:', error)
        }
      }, DEBOUNCE_DELAY)
    },
    [setConfig]
  )

  /** 名称变更 */
  const handleNameChange = (value: string): void => {
    setEditName(value)
    if (selectedPrompt && !selectedPrompt.isBuiltin) {
      debounceSave(selectedPrompt.id, { name: value })
    }
  }

  /** 内容变更 */
  const handleContentChange = (value: string): void => {
    setEditContent(value)
    if (selectedPrompt && !selectedPrompt.isBuiltin) {
      debounceSave(selectedPrompt.id, { content: value })
    }
  }

  /** 更新追加设置 */
  const handleAppendChange = async (enabled: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateAppendSetting(enabled)
      setConfig((prev) => ({ ...prev, appendDateTimeAndUserName: enabled }))
    } catch (error) {
      console.error('[提示词设置] 更新追加设置失败:', error)
    }
  }

  /** 选中 Agent 提示词 */
  const handleAgentSelect = (id: string): void => {
    setAgentSelectedId(id)
  }

  /** 新建 Agent 提示词 */
  const handleAgentCreate = async (): Promise<void> => {
    const input: SystemPromptCreateInput = {
      name: '新 Agent 提示词',
      content: '',
      usageMode: 'agent',
    }
    try {
      const created = await window.electronAPI.createSystemPrompt(input)
      setConfig((prev) => ({
        ...prev,
        prompts: [...prev.prompts, created],
      }))
      setAgentSelectedId(created.id)
      // 同时设为 Agent 当前提示词
      await window.electronAPI.updateAgentPromptId(created.id)
    } catch (error) {
      console.error('[提示词设置] 创建 Agent 提示词失败:', error)
    }
  }

  /** 删除 Agent 提示词 */
  const handleAgentDelete = async (id: string): Promise<void> => {
    // 先检查 ID 是否在当前列表中（防止删除已迁移/不存在的提示词）
    if (!config.prompts.some((p) => p.id === id)) {
      console.warn('[提示词设置] 提示词不存在，可能已迁移或过期:', id)
      return
    }
    try {
      await window.electronAPI.deleteSystemPrompt(id)
      setConfig((prev) => {
        const newPrompts = prev.prompts.filter((p) => p.id !== id)
        const newAgentId = prev.agentPromptId === id ? 'builtin-agent-default' : prev.agentPromptId
        return { ...prev, prompts: newPrompts, agentPromptId: newAgentId }
      })
      // 如果删除的是当前选中的，切换到内置 Agent
      if (agentSelectedId === id) {
        setAgentSelectedId('builtin-agent-default')
      }
    } catch (error) {
      console.error('[提示词设置] 删除 Agent 提示词失败:', error)
    }
  }

  /** Agent 提示词名称变更 */
  const handleAgentNameChange = (value: string): void => {
    setAgentEditName(value)
    if (selectedAgentPrompt && !selectedAgentPrompt.isBuiltin) {
      debounceSaveAgentPrompt(selectedAgentPrompt.id, { name: value })
    }
  }

  /** Agent 提示词内容变更 */
  const handleAgentContentChange = (value: string): void => {
    setAgentEditContent(value)
    if (selectedAgentPrompt && !selectedAgentPrompt.isBuiltin) {
      debounceSaveAgentPrompt(selectedAgentPrompt.id, { content: value })
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="系统提示词" description="切换 Chat / Agent 提示词配置">
        <SettingsCard divided={false} className="p-4">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PromptTab)}>
            <TabsList>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="agent">Agent</TabsTrigger>
            </TabsList>
          </Tabs>
        </SettingsCard>
      </SettingsSection>

      {activeTab === 'chat' && (
        <>
          {/* 提示词列表 */}
          <SettingsSection
            title="Chat 系统提示词"
            description="管理 Chat 模式的系统提示词"
            action={
              <Button size="sm" onClick={handleCreate}>
                <Plus className="size-4 mr-1" />
                新建
              </Button>
            }
          >
            <SettingsCard divided={false} className="p-0">
              <div className="divide-y divide-border/50">
                {config.prompts
                  .filter((p) => p.usageMode === 'chat' || p.usageMode === undefined || p.usageMode === 'both')
                  .map((prompt) => (
                  <PromptListItem
                    key={prompt.id}
                    prompt={prompt}
                    isSelected={prompt.id === selectedId}
                    isDefault={prompt.id === defaultPromptId}
                    isHovered={prompt.id === hoveredId}
                    onSelect={handleSelect}
                    onDelete={handleDelete}
                    onSetDefault={handleSetDefault}
                    onHoverChange={(id) => setHoveredId(id)}
                  />
                ))}
              </div>
            </SettingsCard>
          </SettingsSection>

          {/* 编辑区 */}
          {selectedPrompt && (
            <SettingsSection title="提示词内容">
              <SettingsCard divided={false} className="p-4 space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    名称
                  </label>
                  <Input
                    value={editName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    readOnly={selectedPrompt.isBuiltin}
                    className={cn(selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed')}
                    maxLength={50}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    内容
                  </label>
                  <Textarea
                    value={editContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    readOnly={selectedPrompt.isBuiltin}
                    className={cn(
                      'min-h-[280px] resize-y',
                      selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed'
                    )}
                    placeholder="输入系统提示词内容..."
                  />
                </div>
              </SettingsCard>
            </SettingsSection>
          )}

          {/* 增强选项 */}
          <SettingsSection title="增强选项">
            <SettingsCard>
              <SettingsToggle
                label="追加日期时间和用户名"
                description="在提示词末尾自动追加当前日期时间和用户名"
                checked={config.appendDateTimeAndUserName}
                onCheckedChange={handleAppendChange}
              />
            </SettingsCard>
          </SettingsSection>
        </>
      )}

      {activeTab === 'agent' && (
        <>
          {/* Agent 提示词列表 */}
          <SettingsSection
            title="Agent 系统提示词"
            description="管理 Agent 模式的系统提示词"
            action={
              <Button size="sm" onClick={handleAgentCreate}>
                <Plus className="size-4 mr-1" />
                新建
              </Button>
            }
          >
            <SettingsCard divided={false} className="p-0">
              <div className="divide-y divide-border/50">
                {config.prompts
                  .filter((p) => p.usageMode === 'agent' || p.usageMode === undefined || p.usageMode === 'both')
                  .map((prompt) => (
                  <AgentPromptListItem
                    key={prompt.id}
                    prompt={prompt}
                    isSelected={prompt.id === agentSelectedId}
                    isHovered={prompt.id === hoveredId}
                    onSelect={handleAgentSelect}
                    onDelete={handleAgentDelete}
                    onHoverChange={(id) => setHoveredId(id)}
                  />
                ))}
              </div>
            </SettingsCard>
          </SettingsSection>

          {/* 编辑区 */}
          {selectedAgentPrompt && (
            <SettingsSection title="提示词内容">
              <SettingsCard divided={false} className="p-4 space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    名称
                  </label>
                  <Input
                    value={agentEditName}
                    onChange={(e) => handleAgentNameChange(e.target.value)}
                    readOnly={selectedAgentPrompt.isBuiltin}
                    className={cn(selectedAgentPrompt.isBuiltin && 'opacity-60 cursor-not-allowed')}
                    maxLength={50}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    内容
                  </label>
                  <Textarea
                    value={agentEditContent}
                    onChange={(e) => handleAgentContentChange(e.target.value)}
                    readOnly={selectedAgentPrompt.isBuiltin}
                    className={cn(
                      'min-h-[280px] resize-y',
                      selectedAgentPrompt.isBuiltin && 'opacity-60 cursor-not-allowed'
                    )}
                    placeholder="输入系统提示词内容..."
                  />
                </div>
              </SettingsCard>
            </SettingsSection>
          )}
        </>
      )}
    </div>
  )
}

/** 提示词列表项 */
interface PromptListItemProps {
  prompt: SystemPrompt
  isSelected: boolean
  isDefault: boolean
  isHovered: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
  onHoverChange: (id: string | null) => void
}

function PromptListItem({
  prompt,
  isSelected,
  isDefault,
  isHovered,
  onSelect,
  onDelete,
  onSetDefault,
  onHoverChange,
}: PromptListItemProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors border rounded-md',
        isSelected ? 'border-2 border-green-500 bg-green-500/5' : 'border-border hover:bg-muted/50'
      )}
      onMouseEnter={() => onHoverChange(prompt.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      {/* 名称 + 标记 */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-sm font-medium truncate">{prompt.name}</span>
        {prompt.isBuiltin && (
          <span className="text-xs text-muted-foreground shrink-0">(内置)</span>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 shrink-0">
        {/* 选中按钮 - 仅 hover 时显示 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6 text-muted-foreground hover:text-green-500 transition-opacity',
            isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(prompt.id)
          }}
          title="设为当前"
        >
          <Circle className="size-3.5" />
        </Button>

        {/* 删除按钮 - 仅 hover 时显示 */}
        {prompt.isBuiltin ? (
          <div className="h-6 w-6" />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 text-muted-foreground hover:text-destructive transition-opacity',
              isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(prompt.id)
            }}
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

/** Agent 提示词列表项 */
interface AgentPromptListItemProps {
  prompt: SystemPrompt
  isSelected: boolean
  isHovered: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onHoverChange: (id: string | null) => void
}

function AgentPromptListItem({
  prompt,
  isSelected,
  isHovered,
  onSelect,
  onDelete,
  onHoverChange,
}: AgentPromptListItemProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors border rounded-md',
        isSelected ? 'border-2 border-green-500 bg-green-500/5' : 'border-border hover:bg-muted/50'
      )}
      onMouseEnter={() => onHoverChange(prompt.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      {/* 名称 + 标记 */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-sm font-medium truncate">{prompt.name}</span>
        {prompt.isBuiltin && (
          <span className="text-xs text-muted-foreground shrink-0">(内置)</span>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 shrink-0">
        {/* 选中按钮 - 仅 hover 时显示 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-6 w-6 text-muted-foreground hover:text-green-500 transition-opacity',
            isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(prompt.id)
          }}
          title="设为当前"
        >
          <Circle className="size-3.5" />
        </Button>

        {/* 删除按钮 - 仅 hover 时显示 */}
        {prompt.isBuiltin ? (
          <div className="h-6 w-6" />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 text-muted-foreground hover:text-destructive transition-opacity',
              isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(prompt.id)
            }}
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
