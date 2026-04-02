import * as React from 'react'
import { useAtom } from 'jotai'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'
import { useWindowFullscreen } from '@/hooks/useWindowFullscreen'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface SessionHeaderControlsProps {
  mode: 'chat' | 'agent'
  showCreateButton?: boolean
}

/**
 * 会话头部左侧按钮组：
 * - 侧边栏收起/展开
 * - 新建对话/会话
 */
export function SessionHeaderControls({
  mode,
  showCreateButton = true,
}: SessionHeaderControlsProps): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const isFullscreen = useWindowFullscreen()
  const { createChat, createAgent } = useCreateSession()

  const handleCreate = React.useCallback(() => {
    if (mode === 'agent') {
      void createAgent()
      return
    }
    void createChat()
  }, [mode, createAgent, createChat])

  const needTrafficLightOffset = sidebarCollapsed && !isFullscreen
  const baseButtonClass = 'size-[26px] flex items-center justify-center rounded-md border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
  const sidebarToggleButtonClass = cn(
    baseButtonClass,
    'border-border/60 bg-background/65 text-foreground/65 hover:bg-background/90 hover:text-foreground hover:border-border/80'
  )
  const createButtonClass = cn(
    baseButtonClass,
    'border-primary/35 bg-primary/12 text-primary hover:bg-primary/20 hover:border-primary/50'
  )

  return (
    <div className={cn('h-full flex items-end shrink-0 titlebar-no-drag', needTrafficLightOffset && 'ml-[74px]')}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              className={sidebarToggleButtonClass}
              aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}</TooltipContent>
        </Tooltip>

        {showCreateButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCreate}
                className={createButtonClass}
                aria-label={mode === 'agent' ? '新会话' : '新对话'}
              >
                <Plus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{mode === 'agent' ? '新会话' : '新对话'}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
