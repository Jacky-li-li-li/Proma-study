/**
 * 工作区文件监听器
 *
 * 使用 fs.watch 递归监听 ~/.proma/agent-workspaces/ 目录，
 * 根据变化的文件路径区分事件类型：
 * - mcp.json / skills/ 变化 → 推送 CAPABILITIES_CHANGED（侧边栏刷新）
 * - 其他文件变化 → 推送 WORKSPACE_FILES_CHANGED（文件浏览器刷新）
 *   并携带 hasNewFile，标记本次合并事件中是否包含新增文件/目录
 *
 * 同时支持监听附加目录（外部路径），变化时统一推送 WORKSPACE_FILES_CHANGED。
 *
 * 所有事件均做 debounce 防抖，避免高频文件操作导致渲染进程风暴。
 */

import { watch, existsSync, readdirSync, statSync } from 'node:fs'
import type { FSWatcher, Dirent } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { WorkspaceFilesChangedPayload } from '@proma/shared'
import { getAgentWorkspacesDir } from './config-paths'

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 300

let watcher: FSWatcher | null = null

/** 附加目录监听器：路径 → FSWatcher */
const attachedWatchers = new Map<string, FSWatcher>()
/** 附加目录已知路径快照：用于识别新增文件/目录 */
const attachedKnownPaths = new Map<string, Set<string>>()
/** 附加目录防抖定时器 */
let attachedFilesTimer: ReturnType<typeof setTimeout> | null = null
/** 附加目录防抖窗口内是否出现新增文件/目录 */
let attachedHasNewFileInWindow = false
/** 主窗口引用（供附加目录监听器使用） */
let mainWin: BrowserWindow | null = null

/** 递归收集当前目录下已存在的路径（文件 + 目录） */
function collectExistingPaths(rootDir: string): Set<string> {
  const paths = new Set<string>()
  const stack = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      paths.add(fullPath)
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(fullPath)
      }
    }
  }

  return paths
}

/**
 * 判断是否为“新增文件/目录”
 *
 * fs.watch 在 macOS 下通常使用 rename 事件表示新增/删除/重命名。
 * 这里通过“当前是否存在 + 是否已在快照中出现”做一次近似判定。
 */
function detectNewPathEvent(
  eventType: string,
  absolutePath: string | null,
  knownPaths: Set<string>,
): boolean {
  if (!absolutePath) return false

  const existsNow = existsSync(absolutePath)
  const existedBefore = knownPaths.has(absolutePath)

  if (existsNow) {
    knownPaths.add(absolutePath)
  } else {
    knownPaths.delete(absolutePath)
  }

  // 仅将 rename + “此前不存在、现在存在、且是普通文件” 视为新增
  if (!(eventType === 'rename' && existsNow && !existedBefore)) {
    return false
  }
  try {
    return statSync(absolutePath).isFile()
  } catch {
    return false
  }
}

function sendWorkspaceFilesChanged(win: BrowserWindow, payload: WorkspaceFilesChangedPayload): void {
  if (!win.isDestroyed()) {
    win.webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, payload)
  }
}

/**
 * 启动工作区文件监听
 *
 * @param win 主窗口引用，用于向渲染进程推送事件
 */
export function startWorkspaceWatcher(win: BrowserWindow): void {
  mainWin = win
  const watchDir = getAgentWorkspacesDir()

  if (!existsSync(watchDir)) {
    console.warn('[工作区监听] 目录不存在，跳过:', watchDir)
    return
  }

  // 防抖定时器：按事件类型分别 debounce
  let capabilitiesTimer: ReturnType<typeof setTimeout> | null = null
  let filesTimer: ReturnType<typeof setTimeout> | null = null
  let hasNewFileInWindow = false
  const knownWorkspacePaths = collectExistingPaths(watchDir)

  try {
    watcher = watch(watchDir, { recursive: true }, (eventType, filename) => {
      if (!filename || win.isDestroyed()) return

      const relativePath = String(filename)

      // filename 格式: {slug}/mcp.json 或 {slug}/skills/xxx/SKILL.md 或 {slug}/{sessionId}/file.txt
      const isCapabilitiesChange =
        relativePath.endsWith('/mcp.json') ||
        relativePath.endsWith('\\mcp.json') ||
        relativePath.includes('/skills/') ||
        relativePath.includes('\\skills/')

      if (isCapabilitiesChange) {
        // MCP/Skills 变化 → 通知侧边栏刷新
        if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
        capabilitiesTimer = setTimeout(() => {
          if (!win.isDestroyed()) {
            win.webContents.send(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED)
          }
          capabilitiesTimer = null
        }, DEBOUNCE_MS)
      } else {
        const absolutePath = relativePath ? join(watchDir, relativePath) : null
        if (detectNewPathEvent(eventType, absolutePath, knownWorkspacePaths)) {
          hasNewFileInWindow = true
        }

        // 其他文件变化 → 通知文件浏览器刷新
        if (filesTimer) clearTimeout(filesTimer)
        filesTimer = setTimeout(() => {
          sendWorkspaceFilesChanged(win, { hasNewFile: hasNewFileInWindow })
          hasNewFileInWindow = false
          filesTimer = null
        }, DEBOUNCE_MS)
      }
    })

    console.log('[工作区监听] 已启动文件监听:', watchDir)
  } catch (error) {
    console.error('[工作区监听] 启动失败:', error)
  }
}

/**
 * 停止工作区文件监听
 */
export function stopWorkspaceWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    console.log('[工作区监听] 已停止')
  }
  // 同时清理所有附加目录监听器
  for (const [dirPath, w] of attachedWatchers) {
    w.close()
    console.log('[附加目录监听] 已停止:', dirPath)
  }
  attachedWatchers.clear()
  attachedKnownPaths.clear()
  attachedHasNewFileInWindow = false
  mainWin = null
}

/**
 * 开始监听附加目录
 * 当目录内文件变化时，推送 WORKSPACE_FILES_CHANGED 事件
 */
export function watchAttachedDirectory(dirPath: string): void {
  if (attachedWatchers.has(dirPath)) return
  if (!existsSync(dirPath)) {
    console.warn('[附加目录监听] 目录不存在，跳过:', dirPath)
    return
  }

  try {
    const knownPaths = collectExistingPaths(dirPath)
    attachedKnownPaths.set(dirPath, knownPaths)

    const w = watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!mainWin || mainWin.isDestroyed()) return

      const relativePath = filename
        ? String(filename)
        : null
      const absolutePath = relativePath ? join(dirPath, relativePath) : null
      if (detectNewPathEvent(eventType, absolutePath, knownPaths)) {
        attachedHasNewFileInWindow = true
      }

      // 统一防抖：所有附加目录变化合并为一次刷新
      if (attachedFilesTimer) clearTimeout(attachedFilesTimer)
      attachedFilesTimer = setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) {
          sendWorkspaceFilesChanged(mainWin, { hasNewFile: attachedHasNewFileInWindow })
        }
        attachedHasNewFileInWindow = false
        attachedFilesTimer = null
      }, DEBOUNCE_MS)
    })

    attachedWatchers.set(dirPath, w)
    console.log('[附加目录监听] 已启动:', dirPath)
  } catch (error) {
    console.error('[附加目录监听] 启动失败:', dirPath, error)
  }
}

/**
 * 停止监听附加目录
 */
export function unwatchAttachedDirectory(dirPath: string): void {
  const w = attachedWatchers.get(dirPath)
  if (w) {
    w.close()
    attachedWatchers.delete(dirPath)
    attachedKnownPaths.delete(dirPath)
    console.log('[附加目录监听] 已停止:', dirPath)
  }
}
