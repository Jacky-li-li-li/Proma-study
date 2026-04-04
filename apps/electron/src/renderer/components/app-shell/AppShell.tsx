/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 可折叠] | [MainArea: TabBar + SplitContainer] | [RightSidePanel 可折叠]
 *
 * MainArea 支持多标签页 + 分屏，Settings 视图为独立覆盖。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { RightSidePanel } from './RightSidePanel'
import { MainArea } from '@/components/tabs/MainArea'
import { AppShellProvider, type AppShellContextType } from '@/contexts/AppShellContext'
import { activeTabAtom, sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { currentAgentSessionIdAtom, agentSidePanelOpenMapAtom } from '@/atoms/agent-atoms'

export interface AppShellProps {
  /** Context 值，用于传递给子组件 */
  contextValue: AppShellContextType
}

export function AppShell({ contextValue }: AppShellProps): React.ReactElement {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)

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
                ? 'relative z-[60] p-2 pl-0'
                : 'relative z-[60] p-0'
            }
          >
            <RightSidePanel sessionId={targetAgentSessionId} />
          </div>
        )}
      </div>
    </AppShellProvider>
  )
}
