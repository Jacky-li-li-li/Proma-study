/**
 * ModeSwitcher - Chat/Agent 模式切换（带滑动指示器）
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { streamingConversationIdsAtom } from '@/atoms/chat-atoms'
import { agentRunningSessionIdsAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import { useSwitchModeSession } from '@/hooks/useSwitchModeSession'

const modes: { value: AppMode; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'agent', label: 'Agent' },
]

export function ModeSwitcher(): React.ReactElement {
  const mode = useAtomValue(appModeAtom)
  const chatRunningIds = useAtomValue(streamingConversationIdsAtom)
  const agentRunningIds = useAtomValue(agentRunningSessionIdsAtom)
  const { switchToMode } = useSwitchModeSession()
  const runningCountByMode: Record<AppMode, number> = {
    chat: chatRunningIds.size,
    agent: agentRunningIds.size,
  }

  return (
    <div className="px-2 pt-2">
      <div className="relative flex rounded-lg bg-muted p-1">
        {/* 滑动背景指示器 */}
        <div
          className={cn(
            'mode-slider absolute top-1 bottom-1 w-[calc(50%-4px)] rounded bg-background shadow-sm transition-transform duration-300 ease-in-out',
            mode === 'chat' ? 'translate-x-0' : 'translate-x-full'
          )}
        />
        {modes.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => {
              if (value === mode) return
              void switchToMode(value)
            }}
            className={cn(
              'mode-btn relative z-[1] flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-200',
              mode === value
                ? 'mode-btn-selected text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            {runningCountByMode[value] > 0 && (
              <span
                className={cn(
                  'inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums transition-colors duration-200',
                  mode === value
                    ? 'bg-primary/15 text-primary'
                    : 'bg-foreground/10 text-foreground/70',
                )}
                aria-label={`${label} 运行中会话数 ${runningCountByMode[value]}`}
              >
                {runningCountByMode[value]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
