/**
 * WorkspaceSelector — Agent 工作区切换器
 *
 * 仅展示当前工作区，支持切换、新建、重命名、删除。
 * 切换工作区后持久化到 settings。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { FolderOpen, Plus, Trash2, ArrowRightLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  agentChannelIdAtom,
  agentSessionsAtom,
  agentWorkspacesAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'

export function WorkspaceSelector(): React.ReactElement {
  const store = useStore()
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const switchMenuRef = React.useRef<HTMLDivElement>(null)
  const currentWorkspace = React.useMemo(
    () => workspaces.find((w) => w.id === currentWorkspaceId) ?? workspaces[0] ?? null,
    [workspaces, currentWorkspaceId]
  )
  const switchableWorkspaces = React.useMemo(
    () => currentWorkspace ? workspaces.filter((w) => w.id !== currentWorkspace.id) : [],
    [workspaces, currentWorkspace]
  )

  // 新建状态
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const createInputRef = React.useRef<HTMLInputElement>(null)

  // 重命名状态
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')
  const editInputRef = React.useRef<HTMLInputElement>(null)

  // 删除确认状态
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null)
  // 切换工作区弹窗状态
  const [switchMenuOpen, setSwitchMenuOpen] = React.useState(false)

  const openAgentSession = React.useCallback((session: AgentSessionMeta): void => {
    const tabs = store.get(tabsAtom)
    const layout = store.get(splitLayoutAtom)
    const result = openTab(tabs, layout, {
      type: 'agent',
      sessionId: session.id,
      title: session.title,
    })
    store.set(tabsAtom, result.tabs)
    store.set(splitLayoutAtom, result.layout)
    setCurrentAgentSessionId(session.id)
    setActiveView('conversations')
  }, [store, setCurrentAgentSessionId, setActiveView])

  const syncMainSessionForWorkspace = React.useCallback(async (workspaceId: string): Promise<void> => {
    try {
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)

      const draftSessionIds = store.get(draftSessionIdsAtom)
      const latestSession = sessions.find(
        (session) => !session.archived && session.workspaceId === workspaceId && !draftSessionIds.has(session.id),
      )

      if (latestSession) {
        openAgentSession(latestSession)
        return
      }

      const latestDraftSession = sessions.find(
        (session) => !session.archived && session.workspaceId === workspaceId && draftSessionIds.has(session.id),
      )
      if (latestDraftSession) {
        openAgentSession(latestDraftSession)
        return
      }

      // 新工作区没有历史会话时，创建一个 draft 会话以展示引导内容。
      const draftSession = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId || undefined,
        workspaceId,
      )
      if (store.get(currentAgentWorkspaceIdAtom) !== workspaceId) return

      setAgentSessions((prev) => [draftSession, ...prev.filter((s) => s.id !== draftSession.id)])
      setDraftSessionIds((prev: Set<string>) => {
        if (prev.has(draftSession.id)) return prev
        const next = new Set(prev)
        next.add(draftSession.id)
        return next
      })
      openAgentSession(draftSession)
    } catch (error) {
      console.error('[WorkspaceSelector] 同步主会话失败:', error)
    }
  }, [setAgentSessions, store, openAgentSession, agentChannelId, setDraftSessionIds])

  /** 切换工作区 */
  const handleSelect = (workspace: AgentWorkspace): void => {
    setEditingId(null)
    if (workspace.id === currentWorkspaceId) return
    setCurrentWorkspaceId(workspace.id)
    void syncMainSessionForWorkspace(workspace.id)

    window.electronAPI.updateSettings({
      agentWorkspaceId: workspace.id,
    }).catch(console.error)
  }

  React.useEffect(() => {
    if (currentWorkspaceId || !currentWorkspace) return
    setCurrentWorkspaceId(currentWorkspace.id)
    window.electronAPI.updateSettings({
      agentWorkspaceId: currentWorkspace.id,
    }).catch(console.error)
  }, [currentWorkspaceId, currentWorkspace, setCurrentWorkspaceId])

  React.useEffect(() => {
    setSwitchMenuOpen(false)
  }, [currentWorkspaceId])

  React.useEffect(() => {
    if (!switchMenuOpen) return

    const handlePointerDown = (event: MouseEvent | TouchEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (switchMenuRef.current?.contains(target)) return
      setSwitchMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSwitchMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [switchMenuOpen])

  // ===== 新建 =====

  const handleStartCreate = (): void => {
    setSwitchMenuOpen(false)
    setCreating(true)
    setNewName('')
    requestAnimationFrame(() => {
      createInputRef.current?.focus()
    })
  }

  const handleCreate = async (): Promise<void> => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setCreating(false)
      return
    }

    try {
      const workspace = await window.electronAPI.createAgentWorkspace(trimmed)
      setWorkspaces((prev) => [workspace, ...prev])
      setCurrentWorkspaceId(workspace.id)
      setCreating(false)
      void syncMainSessionForWorkspace(workspace.id)

      window.electronAPI.updateSettings({
        agentWorkspaceId: workspace.id,
      }).catch(console.error)
    } catch (error) {
      console.error('[WorkspaceSelector] 创建工作区失败:', error)
    }
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreate()
    } else if (e.key === 'Escape') {
      setCreating(false)
    }
  }

  const handleClickCreate = (e: React.MouseEvent): void => {
    e.stopPropagation()
    handleStartCreate()
  }

  // ===== 重命名 =====

  const handleStartRename = (e: React.MouseEvent, ws: AgentWorkspace): void => {
    e.stopPropagation()
    setSwitchMenuOpen(false)
    setEditingId(ws.id)
    setEditName(ws.name)
    requestAnimationFrame(() => {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    })
  }

  const handleRename = async (): Promise<void> => {
    if (!editingId) return
    const trimmed = editName.trim()

    if (!trimmed) {
      setEditingId(null)
      return
    }

    try {
      const updated = await window.electronAPI.updateAgentWorkspace(editingId, { name: trimmed })
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
    } catch (error) {
      console.error('[WorkspaceSelector] 重命名工作区失败:', error)
    } finally {
      setEditingId(null)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRename()
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  // ===== 删除 =====

  const handleStartDelete = (e: React.MouseEvent, wsId: string): void => {
    e.stopPropagation()
    setSwitchMenuOpen(false)
    setDeleteTargetId(wsId)
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTargetId) return

    try {
      await window.electronAPI.deleteAgentWorkspace(deleteTargetId)
      const remaining = workspaces.filter((w) => w.id !== deleteTargetId)
      setWorkspaces(remaining)

      // 如果删除的是当前工作区，切换到第一个剩余的
      if (deleteTargetId === currentWorkspaceId && remaining.length > 0) {
        setCurrentWorkspaceId(remaining[0]!.id)
        void syncMainSessionForWorkspace(remaining[0]!.id)
        window.electronAPI.updateSettings({
          agentWorkspaceId: remaining[0]!.id,
        }).catch(console.error)
      }
    } catch (error) {
      console.error('[WorkspaceSelector] 删除工作区失败:', error)
    } finally {
      setDeleteTargetId(null)
    }
  }

  /** 是否可以删除该工作区 */
  const canDelete = (ws: AgentWorkspace): boolean => {
    return ws.slug !== 'default' && workspaces.length > 1
  }

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {/* 仅展示当前工作区 */}
        {currentWorkspace && (
          <div
            className={cn(
              'group relative w-full flex items-center gap-2 px-2.5 py-[5px] rounded-md text-[13px] transition-colors duration-100 titlebar-no-drag',
              'workspace-item-selected bg-foreground/[0.08] text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
            )}
          >
            <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />

            {editingId === currentWorkspace.id ? (
              <input
                ref={editInputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleRename}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground border-b border-primary/50 outline-none px-0.5"
                maxLength={50}
              />
            ) : (
              <>
                <span
                  onDoubleClick={(e) => handleStartRename(e, currentWorkspace)}
                  className="flex-1 min-w-0 truncate"
                  title="双击重命名"
                >
                  {currentWorkspace.name}
                </span>

                {/* 操作按钮 — hover 时显示（切换 / 新建 / 删除） */}
                <div
                  className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => setSwitchMenuOpen((prev) => !prev)}
                    className="p-0.5 rounded hover:bg-foreground/[0.08] text-foreground/30 hover:text-foreground/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="切换工作区"
                    disabled={switchableWorkspaces.length === 0}
                  >
                    <ArrowRightLeft size={12} />
                  </button>

                  <button
                    onClick={handleClickCreate}
                    className="p-0.5 rounded hover:bg-foreground/[0.08] text-foreground/30 hover:text-foreground/60 transition-colors"
                    title="新建工作区"
                  >
                    <Plus size={12} />
                  </button>

                  {canDelete(currentWorkspace) && (
                    <button
                      onClick={(e) => handleStartDelete(e, currentWorkspace.id)}
                      className="p-0.5 rounded hover:bg-destructive/10 text-foreground/30 hover:text-destructive transition-colors"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {switchMenuOpen && switchableWorkspaces.length > 0 && (
                  <div
                    ref={switchMenuRef}
                    className="absolute left-0 top-[calc(100%+6px)] w-full z-[9999] p-1 rounded-md border border-white/20 dark:border-zinc-700/40 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {switchableWorkspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => {
                          handleSelect(ws)
                          setSwitchMenuOpen(false)
                        }}
                        className="w-full text-left rounded-md px-2.5 py-[5px] text-[13px] text-foreground/80 hover:bg-foreground/[0.08] transition-colors"
                      >
                        {ws.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 新建工作区输入框 */}
        {creating ? (
          <div className="flex items-center gap-2 px-2.5 py-[5px]">
            <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
            <input
              ref={createInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              onBlur={() => {
                if (!newName.trim()) setCreating(false)
              }}
              placeholder="工作区名称..."
              className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground border-b border-primary/50 outline-none px-0.5"
              maxLength={50}
            />
          </div>
        ) : (
          !currentWorkspace && (
            <button
              onClick={handleStartCreate}
              className="w-full flex items-center gap-2 px-2.5 py-[5px] rounded-md text-[13px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors duration-100 titlebar-no-drag"
            >
              <Plus size={13} />
              <span>新建工作区</span>
            </button>
          )
        )}
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(v) => { if (!v) setDeleteTargetId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除工作区</AlertDialogTitle>
            <AlertDialogDescription>
              删除后工作区配置将被移除，但目录文件会保留。确定要删除吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
