/**
 * SidePanel — Agent 侧面板容器
 *
 * 直接展示文件浏览器，默认收起状态。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { X, FolderOpen, ExternalLink, RefreshCw, ChevronRight, MoreHorizontal, FolderSearch, Pencil, FolderInput, Info, FolderHeart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { FileBrowser, FileDropZone, FileTypeIcon } from '@/components/file-browser'
import {
  agentSidePanelOpenMapAtom,
  agentSidePanelManualCollapseLockMapAtom,
  agentSidePanelActiveTabMapAtom,
  agentSidePanelWidthMapAtom,
  openAgentSidePanelAtom,
  workspaceFilesVersionAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  agentAttachedDirectoriesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  type AgentSidePanelTab,
} from '@/atoms/agent-atoms'
import type { FileEntry } from '@proma/shared'

interface SidePanelProps {
  sessionId: string
  sessionPath: string | null
}

const SIDE_PANEL_DEFAULT_WIDTH = 320
const SIDE_PANEL_MIN_WIDTH = 280
const SIDE_PANEL_MAX_WIDTH = 480
const SIDE_PANEL_TRANSITION_MS = 220

function clampSidePanelWidth(width: number): number {
  return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(SIDE_PANEL_MAX_WIDTH, width))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SidePanel({ sessionId, sessionPath }: SidePanelProps): React.ReactElement {
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const setSidePanelOpenMap = useSetAtom(agentSidePanelOpenMapAtom)
  const sidePanelActiveTabMap = useAtomValue(agentSidePanelActiveTabMapAtom)
  const setSidePanelActiveTabMap = useSetAtom(agentSidePanelActiveTabMapAtom)
  const sidePanelWidthMap = useAtomValue(agentSidePanelWidthMapAtom)
  const setSidePanelWidthMap = useSetAtom(agentSidePanelWidthMapAtom)
  const openAgentSidePanel = useSetAtom(openAgentSidePanelAtom)
  const setSidePanelManualCollapseLockMap = useSetAtom(agentSidePanelManualCollapseLockMapAtom)

  const isOpen = sidePanelOpenMap.get(sessionId) ?? false
  const activeTab = sidePanelActiveTabMap.get(sessionId) ?? 'session'
  const panelWidth = clampSidePanelWidth(sidePanelWidthMap.get(sessionId) ?? SIDE_PANEL_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const resizeFrameRef = React.useRef<number | null>(null)
  const resizePendingWidthRef = React.useRef(panelWidth)

  React.useEffect(() => {
    resizePendingWidthRef.current = panelWidth
  }, [panelWidth, sessionId])

  // 右侧面板开合期间广播布局过渡，供消息导航等组件暂避抖动
  const prevTransitionOpenRef = React.useRef(isOpen)
  const transitionTimerRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (prevTransitionOpenRef.current === isOpen) return
    prevTransitionOpenRef.current = isOpen

    window.dispatchEvent(new CustomEvent('proma:sidebar-transition', { detail: { active: true } }))
    if (transitionTimerRef.current != null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
    transitionTimerRef.current = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('proma:sidebar-transition', { detail: { active: false } }))
      transitionTimerRef.current = null
    }, SIDE_PANEL_TRANSITION_MS)
  }, [isOpen])

  React.useEffect(() => {
    return () => {
      if (transitionTimerRef.current != null) {
        window.clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = null
      }
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      window.dispatchEvent(new CustomEvent('proma:sidebar-transition', { detail: { active: false } }))
    }
  }, [])

  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const setFilesVersion = useSetAtom(workspaceFilesVersionAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null

  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []

  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const setWsAttachedDirsMap = useSetAtom(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []

  React.useEffect(() => {
    if (!workspaceSlug || !currentWorkspaceId) return
    window.electronAPI.getWorkspaceDirectories(workspaceSlug)
      .then((dirs) => {
        setWsAttachedDirsMap((prev) => {
          const map = new Map(prev)
          map.set(currentWorkspaceId, dirs)
          return map
        })
      })
      .catch((error) => {
        console.error('[SidePanel] 加载工作区附加目录失败:', error)
        toast.error('加载工作区附加目录失败', { description: getErrorMessage(error) })
      })
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  const setActiveTab = React.useCallback((nextTab: AgentSidePanelTab) => {
    setSidePanelActiveTabMap((prev) => {
      const current = prev.get(sessionId) ?? 'session'
      if (current === nextTab) return prev
      const map = new Map(prev)
      map.set(sessionId, nextTab)
      return map
    })
  }, [sessionId, setSidePanelActiveTabMap])

  const handleClosePanel = React.useCallback(() => {
    setSidePanelOpenMap((prev) => {
      const current = prev.get(sessionId) ?? false
      if (!current) return prev
      const map = new Map(prev)
      map.set(sessionId, false)
      return map
    })
    setSidePanelManualCollapseLockMap((prev) => {
      if (prev.get(sessionId) === true) return prev
      const map = new Map(prev)
      map.set(sessionId, true)
      return map
    })
  }, [sessionId, setSidePanelOpenMap, setSidePanelManualCollapseLockMap])

  const updatePanelWidth = React.useCallback((nextWidth: number) => {
    const clamped = clampSidePanelWidth(nextWidth)
    setSidePanelWidthMap((prev) => {
      const current = clampSidePanelWidth(prev.get(sessionId) ?? SIDE_PANEL_DEFAULT_WIDTH)
      if (current === clamped) return prev
      const map = new Map(prev)
      map.set(sessionId, clamped)
      return map
    })
  }, [sessionId, setSidePanelWidthMap])

  const handleResizePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isOpen) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = panelWidth
    let latestWidth = startWidth
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsResizing(true)

    const applyWidthToDom = (nextWidth: number): void => {
      if (rootRef.current) rootRef.current.style.width = `${nextWidth}px`
      if (contentRef.current) contentRef.current.style.width = `${nextWidth}px`
    }

    const scheduleWidthApply = (nextWidth: number): void => {
      latestWidth = nextWidth
      resizePendingWidthRef.current = nextWidth
      if (resizeFrameRef.current != null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        applyWidthToDom(latestWidth)
      })
    }

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const delta = startX - moveEvent.clientX
      scheduleWidthApply(clampSidePanelWidth(startWidth + delta))
    }

    const handlePointerUp = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      applyWidthToDom(resizePendingWidthRef.current)
      updatePanelWidth(resizePendingWidthRef.current)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      setIsResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [isOpen, panelWidth, updatePanelWidth])

  const openByLocalFileAdded = React.useCallback((tab: AgentSidePanelTab) => {
    openAgentSidePanel({
      sessionId,
      reason: 'local_file_added',
      tab,
    })
  }, [openAgentSidePanel, sessionId])

  const handleAttachFolder = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      const updated = await window.electronAPI.attachDirectory({
        sessionId,
        directoryPath: result.path,
      })
      setAttachedDirsMap((prev) => {
        const map = new Map(prev)
        map.set(sessionId, updated)
        return map
      })
      openByLocalFileAdded('session')
    } catch (error) {
      console.error('[SidePanel] 附加文件夹失败:', error)
      toast.error('附加文件夹失败', { description: getErrorMessage(error) })
    }
  }, [sessionId, setAttachedDirsMap, openByLocalFileAdded])

  const handleDetachDirectory = React.useCallback(async (dirPath: string) => {
    try {
      const updated = await window.electronAPI.detachDirectory({
        sessionId,
        directoryPath: dirPath,
      })
      setAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) {
          map.set(sessionId, updated)
        } else {
          map.delete(sessionId)
        }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除附加目录失败:', error)
      toast.error('移除附加目录失败', { description: getErrorMessage(error) })
    }
  }, [sessionId, setAttachedDirsMap])

  // 工作区级附加文件夹
  const handleAttachWorkspaceFolder = React.useCallback(async () => {
    if (!workspaceSlug || !currentWorkspaceId) return
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      const updated = await window.electronAPI.attachWorkspaceDirectory({
        workspaceSlug,
        directoryPath: result.path,
      })
      setWsAttachedDirsMap((prev) => {
        const map = new Map(prev)
        map.set(currentWorkspaceId, updated)
        return map
      })
      openByLocalFileAdded('workspace')
    } catch (error) {
      console.error('[SidePanel] 附加工作区文件夹失败:', error)
      toast.error('附加工作区文件夹失败', { description: getErrorMessage(error) })
    }
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap, openByLocalFileAdded])

  const handleDetachWorkspaceDirectory = React.useCallback(async (dirPath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    try {
      const updated = await window.electronAPI.detachWorkspaceDirectory({
        workspaceSlug,
        directoryPath: dirPath,
      })
      setWsAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) {
          map.set(currentWorkspaceId, updated)
        } else {
          map.delete(currentWorkspaceId)
        }
        return map
      })
    } catch (error) {
      console.error('[SidePanel] 移除工作区附加目录失败:', error)
      toast.error('移除工作区附加目录失败', { description: getErrorMessage(error) })
    }
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  const bumpFilesVersion = React.useCallback(() => {
    setFilesVersion((prev) => prev + 1)
  }, [setFilesVersion])

  const handleSessionFilesUploaded = React.useCallback(() => {
    bumpFilesVersion()
    openByLocalFileAdded('session')
  }, [bumpFilesVersion, openByLocalFileAdded])

  const handleWorkspaceFilesUploaded = React.useCallback(() => {
    bumpFilesVersion()
    openByLocalFileAdded('workspace')
  }, [bumpFilesVersion, openByLocalFileAdded])

  const handleRefresh = React.useCallback(() => {
    setFilesVersion((prev) => prev + 1)
  }, [setFilesVersion])

  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!workspaceSlug) {
      setWorkspaceFilesPath(null)
      return
    }
    window.electronAPI.getWorkspaceFilesPath(workspaceSlug).then(setWorkspaceFilesPath).catch(() => setWorkspaceFilesPath(null))
  }, [workspaceSlug])

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative h-full flex-shrink-0 overflow-hidden titlebar-drag-region rounded-2xl bg-content-area/95',
        isOpen ? 'border border-border/60 shadow-sm' : 'border border-transparent shadow-none',
        isResizing ? 'transition-none' : 'transition-[width] duration-200 ease-out',
      )}
      style={{ width: isOpen ? panelWidth : 0 }}
    >
      {isOpen && (
        <div
          className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize titlebar-no-drag"
          onPointerDown={handleResizePointerDown}
          aria-hidden
        />
      )}
      <div
        ref={contentRef}
        className={cn(
          'h-full flex flex-col titlebar-no-drag pt-3 px-2 pb-2',
          !isOpen && 'pointer-events-none',
        )}
        style={{ width: panelWidth }}
      >
        {sessionPath && workspaceSlug ? (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as AgentSidePanelTab)}
            className="flex-1 min-h-0 flex flex-col"
          >
            <div className="h-8 flex items-center gap-1 px-1 shrink-0">
              <TabsList className="h-7 rounded-md bg-muted/40 p-0.5">
                <TabsTrigger value="session" className="h-6 px-2.5 text-[11px]">会话文件</TabsTrigger>
                <TabsTrigger value="workspace" className="h-6 px-2.5 text-[11px]">工作区文件</TabsTrigger>
              </TabsList>
              <div className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleRefresh}
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>刷新文件列表</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleClosePanel}
                  >
                    <X className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>关闭侧面板</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="mt-2 flex-1 min-h-0 overflow-hidden rounded-xl border border-border/60 bg-background/35">
              <div className="h-full overflow-y-auto px-1 pb-1">
                {activeTab === 'session' ? (
                  <>
                    <div className="flex items-center gap-1 px-2 pt-2 h-8">
                      <FolderOpen className="size-3 text-muted-foreground" />
                      <span className="text-[11px] font-medium text-muted-foreground">会话文件</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[200px]">
                          <p>当前会话的专属文件，仅本次对话的 Agent 可以访问</p>
                        </TooltipContent>
                      </Tooltip>
                      <div className="flex-1" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 flex-shrink-0"
                            onClick={() => window.electronAPI.openFile(sessionPath).catch(console.error)}
                          >
                            <ExternalLink className="size-2.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p>在 Finder 中打开</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {attachedDirs.length > 0 && (
                      <AttachedDirsSection
                        attachedDirs={attachedDirs}
                        onDetach={handleDetachDirectory}
                        refreshVersion={filesVersion}
                      />
                    )}
                    <FileBrowser rootPath={sessionPath} hideToolbar embedded />
                    <FileDropZone
                      workspaceSlug={workspaceSlug}
                      sessionId={sessionId}
                      target="session"
                      onFilesUploaded={handleSessionFilesUploaded}
                      onAttachFolder={handleAttachFolder}
                    />
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1 px-2 pt-2 h-8">
                      <FolderHeart className="size-3 text-muted-foreground" />
                      <span className="text-[11px] font-medium text-muted-foreground">工作区文件</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[220px]">
                          <p>工作区内所有会话可访问的文件和文件夹，每个新对话都可以自动读取</p>
                        </TooltipContent>
                      </Tooltip>
                      <div className="flex-1" />
                      {workspaceFilesPath && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 flex-shrink-0"
                              onClick={() => window.electronAPI.openFile(workspaceFilesPath).catch(console.error)}
                            >
                              <ExternalLink className="size-2.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>在 Finder 中打开工作区文件目录</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {wsAttachedDirs.length > 0 && (
                      <AttachedDirsSection
                        attachedDirs={wsAttachedDirs}
                        onDetach={handleDetachWorkspaceDirectory}
                        refreshVersion={filesVersion}
                      />
                    )}
                    {workspaceFilesPath && (
                      <FileBrowser
                        rootPath={workspaceFilesPath}
                        hideToolbar
                        embedded
                        showEmptyState={wsAttachedDirs.length === 0}
                        emptyStateText="工作区文件目录为空"
                      />
                    )}
                    <FileDropZone
                      workspaceSlug={workspaceSlug}
                      target="workspace"
                      onFilesUploaded={handleWorkspaceFilesUploaded}
                      onAttachFolder={handleAttachWorkspaceFolder}
                    />
                  </>
                )}
              </div>
            </div>
          </Tabs>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-end h-8 px-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleClosePanel}
                  >
                    <X className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>关闭侧面板</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              请选择工作区
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 附加目录容器（管理选中状态） =====

interface AttachedDirsSectionProps {
  attachedDirs: string[]
  onDetach: (dirPath: string) => void
  /** 文件版本号，用于自动刷新已展开的目录 */
  refreshVersion: number
}

/** 附加目录区域：统一管理所有子项的选中状态 */
function AttachedDirsSection({ attachedDirs, onDetach, refreshVersion }: AttachedDirsSectionProps): React.ReactElement {
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set())

  const handleSelect = React.useCallback((path: string, ctrlKey: boolean) => {
    setSelectedPaths((prev) => {
      if (ctrlKey) {
        // Ctrl+点击：切换选中
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      }
      // 普通点击：单选
      return new Set([path])
    })
  }, [])

  return (
    <div className="pt-2.5 pb-1 flex-shrink-0">
      <div className="text-[11px] font-medium text-muted-foreground mb-1 px-3">附加目录（Agent 可以读取并操作此文件夹）</div>
      <div className="text-[10px] text-muted-foreground/75 mb-1 px-3">点击左侧箭头展开目录</div>
      {attachedDirs.map((dir) => (
        <AttachedDirTree
          key={dir}
          dirPath={dir}
          onDetach={() => onDetach(dir)}
          selectedPaths={selectedPaths}
          onSelect={handleSelect}
          refreshVersion={refreshVersion}
        />
      ))}
    </div>
  )
}

// ===== 附加目录树组件 =====

interface AttachedDirTreeProps {
  dirPath: string
  onDetach: () => void
  selectedPaths: Set<string>
  onSelect: (path: string, ctrlKey: boolean) => void
  /** 文件版本号，变化时已展开的目录自动重新加载 */
  refreshVersion: number
}

/** 附加目录根节点：可展开/收起，带移除按钮 */
function AttachedDirTree({ dirPath, onDetach, selectedPaths, onSelect, refreshVersion }: AttachedDirTreeProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const isSelected = selectedPaths.has(dirPath)

  const dirName = dirPath.split('/').filter(Boolean).pop() || dirPath

  // 当 refreshVersion 变化时，已展开的目录自动重新加载
  React.useEffect(() => {
    if (expanded && loaded) {
      window.electronAPI.listAttachedDirectory(dirPath)
        .then((items) => setChildren(items))
        .catch((err) => {
          console.error('[AttachedDirTree] 刷新失败:', err)
          toast.error('刷新附加目录失败', { description: getErrorMessage(err) })
        })
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = async (): Promise<void> => {
    if (!expanded && !loaded) {
      try {
        const items = await window.electronAPI.listAttachedDirectory(dirPath)
        setChildren(items)
        setLoaded(true)
      } catch (err) {
        console.error('[AttachedDirTree] 加载失败:', err)
        toast.error('加载附加目录失败', { description: getErrorMessage(err) })
      }
    }
    setExpanded(!expanded)
  }

  const handleRowClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect(dirPath, e.ctrlKey || e.metaKey)
  }

  const handleChevronClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void toggleExpand()
  }

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-2 cursor-pointer group',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
        onClick={handleRowClick}
      >
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150 cursor-pointer hover:text-foreground/85',
            expanded && 'rotate-90',
          )}
          onClick={handleChevronClick}
        />
        <FileTypeIcon name={dirName} isDirectory isOpen={expanded} />
        <span className="text-xs truncate flex-1" title={dirPath}>
          {dirName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onDetach() }}
        >
          <X className="size-3" />
        </Button>
      </div>
      {expanded && children.length === 0 && loaded && (
        <div className="text-[11px] text-muted-foreground/50 py-1" style={{ paddingLeft: 48 }}>
          空文件夹
        </div>
      )}
      {expanded && children.map((child) => (
        <AttachedDirItem key={child.path} entry={child} depth={1} selectedPaths={selectedPaths} onSelect={onSelect} refreshVersion={refreshVersion} />
      ))}
    </div>
  )
}

interface AttachedDirItemProps {
  entry: FileEntry
  depth: number
  selectedPaths: Set<string>
  onSelect: (path: string, ctrlKey: boolean) => void
  /** 文件版本号，变化时已展开的目录自动重新加载 */
  refreshVersion: number
}

/** 附加目录子项：递归可展开，支持选中 + 三点菜单（含重命名、移动） */
function AttachedDirItem({ entry, depth, selectedPaths, onSelect, refreshVersion }: AttachedDirItemProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [loaded, setLoaded] = React.useState(false)
  // 重命名状态
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(entry.name)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  // 当前显示的名称和路径（重命名后更新）
  const [currentName, setCurrentName] = React.useState(entry.name)
  const [currentPath, setCurrentPath] = React.useState(entry.path)

  const isSelected = selectedPaths.has(currentPath)

  // 当 refreshVersion 变化时，已展开的文件夹自动重新加载子项
  React.useEffect(() => {
    if (expanded && loaded && entry.isDirectory) {
      window.electronAPI.listAttachedDirectory(currentPath)
        .then((items) => setChildren(items))
        .catch((err) => {
          console.error('[AttachedDirItem] 刷新子目录失败:', err)
          toast.error('刷新附加目录失败', { description: getErrorMessage(err) })
        })
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = async (): Promise<void> => {
    if (!entry.isDirectory) return
    if (!expanded && !loaded) {
      try {
        const items = await window.electronAPI.listAttachedDirectory(currentPath)
        setChildren(items)
        setLoaded(true)
      } catch (err) {
        console.error('[AttachedDirItem] 加载子目录失败:', err)
        toast.error('加载附加目录失败', { description: getErrorMessage(err) })
      }
    }
    setExpanded(!expanded)
  }

  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect(currentPath, e.ctrlKey || e.metaKey)
  }

  const handleChevronClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void toggleDir()
  }

  const handleDoubleClick = (): void => {
    if (!entry.isDirectory) {
      window.electronAPI.openAttachedFile(currentPath).catch(console.error)
    }
  }

  // 开始重命名
  const startRename = (): void => {
    setRenameValue(currentName)
    setIsRenaming(true)
    // 延迟聚焦，等待 DOM 渲染
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  // 确认重命名
  const confirmRename = async (): Promise<void> => {
    const newName = renameValue.trim()
    if (!newName || newName === currentName) {
      setIsRenaming(false)
      return
    }
    try {
      await window.electronAPI.renameAttachedFile(currentPath, newName)
      // 更新本地显示
      const parentDir = currentPath.substring(0, currentPath.lastIndexOf('/'))
      const newPath = `${parentDir}/${newName}`
      // 更新选中状态中的路径
      onSelect(newPath, false)
      setCurrentName(newName)
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 重命名失败:', err)
      toast.error('重命名失败', { description: getErrorMessage(err) })
    }
    setIsRenaming(false)
  }

  // 取消重命名
  const cancelRename = (): void => {
    setIsRenaming(false)
    setRenameValue(currentName)
  }

  // 移动到文件夹
  const handleMove = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return
      await window.electronAPI.moveAttachedFile(currentPath, result.path)
      // 移动后更新路径
      const newPath = `${result.path}/${currentName}`
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 移动失败:', err)
      toast.error('移动失败', { description: getErrorMessage(err) })
    }
  }

  const paddingLeft = 8 + depth * 16

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 py-1 pr-2 text-sm cursor-pointer group',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
        style={{ paddingLeft }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {entry.isDirectory ? (
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150 cursor-pointer hover:text-foreground/85',
              expanded && 'rotate-90',
            )}
            onClick={handleChevronClick}
          />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        <FileTypeIcon name={currentName} isDirectory={entry.isDirectory} isOpen={expanded} />

        {/* 名称：正常显示 / 重命名输入框 */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="text-xs flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0.5 outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') cancelRename()
              e.stopPropagation()
            }}
            onBlur={cancelRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-xs flex-1">{currentName}</span>
        )}

        {/* 三点菜单按钮（始终占位，避免选中时行高跳动） */}
        <div
          className={cn('flex-shrink-0', !(isSelected && !isRenaming) && 'invisible')}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent/70"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            {isSelected && !isRenaming && (
              <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={() => window.electronAPI.showAttachedInFolder(currentPath).catch(console.error)}
                >
                  <FolderSearch />
                  在文件夹中显示
                </DropdownMenuItem>
                {!entry.isDirectory && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => window.electronAPI.openAttachedFile(currentPath).catch(console.error)}
                  >
                    <ExternalLink />
                    打开文件
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={startRename}
                >
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={handleMove}
                >
                  <FolderInput />
                  移动到...
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      </div>
      {expanded && children.length === 0 && loaded && (
        <div
          className="text-[11px] text-muted-foreground/50 py-1"
          style={{ paddingLeft: paddingLeft + 24 }}
        >
          空文件夹
        </div>
      )}
      {expanded && children.map((child) => (
        <AttachedDirItem key={child.path} entry={child} depth={depth + 1} selectedPaths={selectedPaths} onSelect={onSelect} refreshVersion={refreshVersion} />
      ))}
    </>
  )
}
