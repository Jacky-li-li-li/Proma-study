import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@proma/shared'

function collectMatches(source: string, pattern: RegExp): Set<string> {
  const result = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const key = match[1]
    if (key) result.add(key)
  }
  return result
}

describe('agent ipc contract', () => {
  test('shared channels must align with preload/main implementations', () => {
    const repoRoot = resolve(import.meta.dir, '../../../../../')
    const preloadSource = readFileSync(resolve(repoRoot, 'apps/electron/src/preload/index.ts'), 'utf-8')
    const mainIpcSource = readFileSync(resolve(repoRoot, 'apps/electron/src/main/ipc.ts'), 'utf-8')
    const agentServiceSource = readFileSync(resolve(repoRoot, 'apps/electron/src/main/lib/agent-service.ts'), 'utf-8')
    const workspaceWatcherSource = readFileSync(resolve(repoRoot, 'apps/electron/src/main/lib/workspace-watcher.ts'), 'utf-8')

    const preloadInvokes = collectMatches(preloadSource, /ipcRenderer\.invoke\(\s*AGENT_IPC_CHANNELS\.([A-Z0-9_]+)/g)
    const preloadListeners = collectMatches(preloadSource, /ipcRenderer\.on\(\s*AGENT_IPC_CHANNELS\.([A-Z0-9_]+)/g)

    const mainHandles = collectMatches(mainIpcSource, /ipcMain\.handle\(\s*AGENT_IPC_CHANNELS\.([A-Z0-9_]+)/g)
    const mainSends = new Set<string>([
      ...collectMatches(mainIpcSource, /\.send\(\s*AGENT_IPC_CHANNELS\.([A-Z0-9_]+)/g),
      ...collectMatches(agentServiceSource, /\.send\(\s*AGENT_IPC_CHANNELS\.([A-Z0-9_]+)/g),
      ...collectMatches(workspaceWatcherSource, /\.send\(\s*AGENT_IPC_CHANNELS\.([A-Z0-9_]+)/g),
    ])

    const pushChannels = new Set<string>([
      'STREAM_EVENT',
      'STREAM_COMPLETE',
      'STREAM_ERROR',
      'TITLE_UPDATED',
      'CAPABILITIES_CHANGED',
      'WORKSPACE_FILES_CHANGED',
      'QUEUED_MESSAGE_STATUS',
    ])

    for (const key of Object.keys(AGENT_IPC_CHANNELS)) {
      if (pushChannels.has(key)) {
        expect(preloadListeners.has(key)).toBe(true)
        expect(mainSends.has(key)).toBe(true)
      } else {
        expect(preloadInvokes.has(key)).toBe(true)
        expect(mainHandles.has(key)).toBe(true)
      }
    }
  })
})
