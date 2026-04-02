/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 可折叠] | [MainArea: TabBar + SplitContainer] | [RightSidePanel 可折叠]
 *
 * MainArea 支持多标签页 + 分屏，Settings 视图为独立覆盖。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { RightSidePanel } from './RightSidePanel'
import { MainArea } from '@/components/tabs/MainArea'
import { AppShellProvider, type AppShellContextType } from '@/contexts/AppShellContext'
import { activeTabAtom, sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { userProfileAtom } from '@/atoms/user-profile'
import { hasUpdateAtom } from '@/atoms/updater'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { appModeAtom } from '@/atoms/app-mode'
import { currentAgentSessionIdAtom, agentSidePanelOpenMapAtom } from '@/atoms/agent-atoms'

export interface AppShellProps {
  /** Context 值，用于传递给子组件 */
  contextValue: AppShellContextType
}

export function AppShell({ contextValue }: AppShellProps): React.ReactElement {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  const userProfile = useAtomValue(userProfileAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const [sidebarAvatarRect, setSidebarAvatarRect] = React.useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [floatingAvatarVisible, setFloatingAvatarVisible] = React.useState(sidebarCollapsed)

  const measureSidebarAvatar = React.useCallback(() => {
    const anchor = document.querySelector<HTMLElement>('[data-sidebar-avatar-anchor]')
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    setSidebarAvatarRect((prev) => {
      const next = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
      if (
        prev != null &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.top - next.top) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5
      ) {
        return prev
      }
      return next
    })
  }, [])

  React.useLayoutEffect(() => {
    if (sidebarCollapsed) return

    measureSidebarAvatar()

    const sidebarRoot = document.querySelector<HTMLElement>('[data-left-sidebar-root]')
    const anchor = document.querySelector<HTMLElement>('[data-sidebar-avatar-anchor]')
    const observer = new ResizeObserver(() => {
      measureSidebarAvatar()
    })

    if (sidebarRoot) observer.observe(sidebarRoot)
    if (anchor) observer.observe(anchor)

    window.addEventListener('resize', measureSidebarAvatar)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureSidebarAvatar)
    }
  }, [sidebarCollapsed, measureSidebarAvatar])

  const floatingAvatarSize = sidebarAvatarRect?.width ?? 28

  React.useEffect(() => {
    if (sidebarCollapsed) {
      setFloatingAvatarVisible(true)
      return
    }

    let stopped = false
    let rafId: number | null = null
    let settleRafId: number | null = null
    const fallbackTimer = window.setTimeout(() => {
      if (!stopped) setFloatingAvatarVisible(false)
    }, 220)

    const waitForAnchorReady = (): void => {
      if (stopped) return

      const anchor = document.querySelector<HTMLElement>('[data-sidebar-avatar-anchor]')
      if (!anchor) {
        rafId = window.requestAnimationFrame(waitForAnchorReady)
        return
      }
      const rect = anchor.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        rafId = window.requestAnimationFrame(waitForAnchorReady)
        return
      }

      settleRafId = window.requestAnimationFrame(() => {
        if (stopped) return
        setFloatingAvatarVisible(false)
      })
    }

    waitForAnchorReady()
    return () => {
      stopped = true
      window.clearTimeout(fallbackTimer)
      if (rafId != null) window.cancelAnimationFrame(rafId)
      if (settleRafId != null) window.cancelAnimationFrame(settleRafId)
    }
  }, [sidebarCollapsed])

  const appMode = useAtomValue(appModeAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const targetAgentSessionId = activeTab?.type === 'agent'
    ? activeTab.sessionId
    : currentAgentSessionId
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const showRightPanel = appMode === 'agent' && !!targetAgentSessionId
  const isCurrentSidePanelOpen = targetAgentSessionId
    ? (sidePanelOpenMap.get(targetAgentSessionId) ?? false)
    : false

  return (
    <AppShellProvider value={contextValue}>
      <div className="shell-bg h-screen w-screen flex overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
        {/* 左侧边栏：可折叠，带圆角和内边距 */}
        <div className={sidebarCollapsed ? 'relative z-[60]' : 'p-2 pr-0 relative z-[60]'}>
          <LeftSidebar />
        </div>

        {/* 右侧容器：relative z-[60] 使其在 z-50 拖动区域之上 */}
        <div className="flex-1 min-w-0 p-2 relative z-[60]">
          {/* 主内容区域（TabBar + SplitContainer） */}
          <MainArea />
        </div>

        {/* 右侧边栏：Agent 文件面板，带圆角和内边距 */}
        {showRightPanel && (
          <div
            className={
              isCurrentSidePanelOpen
                ? 'relative z-[60] transition-[padding] duration-300 ease-in-out p-2 pl-0'
                : 'relative z-[60] transition-[padding] duration-300 ease-in-out p-0'
            }
          >
            <RightSidePanel sessionId={targetAgentSessionId} />
          </div>
        )}
      </div>

      {floatingAvatarVisible && (
        <div
          className="fixed z-[80] titlebar-no-drag"
          style={sidebarAvatarRect == null
            ? { left: 32, bottom: 28, pointerEvents: sidebarCollapsed ? 'auto' : 'none' }
            : {
              left: sidebarAvatarRect.left,
              top: sidebarAvatarRect.top,
              width: sidebarAvatarRect.width,
              height: sidebarAvatarRect.height,
              pointerEvents: sidebarCollapsed ? 'auto' : 'none',
            }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="relative titlebar-no-drag hover:opacity-90 transition-opacity"
                style={sidebarAvatarRect == null ? undefined : { width: '100%', height: '100%' }}
                aria-label="打开设置"
              >
                <UserAvatar avatar={userProfile.avatar} size={floatingAvatarSize} />
                {(hasUpdate || hasEnvironmentIssues) && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">设置</TooltipContent>
          </Tooltip>
        </div>
      )}
    </AppShellProvider>
  )
}
