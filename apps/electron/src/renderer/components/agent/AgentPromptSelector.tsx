/**
 * AgentPromptSelector - AgentHeader 系统提示词下拉选择器
 *
 * 参考 SystemPromptSelector 实现，在 Agent 模式 header 中提供提示词切换功能。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { BookOpen, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  promptConfigAtom,
  agentPromptIdAtom,
} from '@/atoms/system-prompt-atoms'
import { cn } from '@/lib/utils'

export function AgentPromptSelector(): React.ReactElement {
  const [config, setConfig] = useAtom(promptConfigAtom)
  const [selectedId, setSelectedId] = useAtom(agentPromptIdAtom)
  const [open, setOpen] = React.useState(false)

  /** 懒加载配置 */
  React.useEffect(() => {
    window.electronAPI.getSystemPromptConfig().then((cfg) => {
      setConfig(cfg)
      // 如果当前选中 ID 不在配置中（迁移等原因），使用后端默认值
      if (!cfg.prompts.some((p) => p.id === selectedId)) {
        setSelectedId(cfg.agentPromptId ?? 'builtin-agent-default')
      }
    }).catch(console.error)
  }, [setConfig])

  const selectedPrompt = config.prompts.find((p) => p.id === selectedId)
  const tooltipText = selectedPrompt ? `提示词: ${selectedPrompt.name}` : '选择提示词'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={tooltipText}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <BookOpen className="size-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56 z-[60]">
        {config.prompts
          .filter((p) => p.usageMode === 'agent' || p.usageMode === undefined || p.usageMode === 'both')
          .map((prompt) => (
          <div
            key={prompt.id}
            onClick={() => {
              setSelectedId(prompt.id)
              // 持久化到配置文件
              window.electronAPI.updateAgentPromptId(prompt.id).catch(console.error)
              setOpen(false)
            }}
            className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {/* 选中标记 */}
            <Check className={cn(
              'size-4 shrink-0',
              prompt.id === selectedId ? 'opacity-100' : 'opacity-0'
            )} />

            {/* 名称 */}
            <span className="flex-1 truncate">{prompt.name}</span>

            {/* 内置标记 */}
            {prompt.isBuiltin && (
              <span className="text-xs text-muted-foreground shrink-0">(内置)</span>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
