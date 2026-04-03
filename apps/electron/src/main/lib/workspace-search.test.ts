import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { resolveSearchRoots } from './workspace-search'

describe('workspace-search', () => {
  test('allows workspace-files path and attached directory path in one search', () => {
    const workspaceRoot = resolve('/tmp', 'agent-workspaces')
    const sessionRoot = resolve(workspaceRoot, 'workspace-a', 'session-1')
    const workspaceFiles = resolve(workspaceRoot, 'workspace-a', 'workspace-files')
    const attachedRoot = resolve('/tmp', 'external-project')

    const result = resolveSearchRoots({
      rootPath: sessionRoot,
      workspaceRoot,
      attachedRoots: [attachedRoot],
      additionalPaths: [workspaceFiles, attachedRoot],
    })

    expect(result.scanRoots).toEqual([sessionRoot, workspaceFiles, attachedRoot])
    expect(result.skippedAdditionalPaths).toEqual([])
  })

  test('skips invalid additional paths instead of failing the whole search', () => {
    const workspaceRoot = resolve('/tmp', 'agent-workspaces')
    const sessionRoot = resolve(workspaceRoot, 'workspace-a', 'session-1')
    const attachedRoot = resolve('/tmp', 'external-project')
    const validAdditional = resolve(attachedRoot, 'docs')

    const result = resolveSearchRoots({
      rootPath: sessionRoot,
      workspaceRoot,
      attachedRoots: [attachedRoot],
      additionalPaths: [validAdditional, '/etc/passwd'],
    })

    expect(result.scanRoots).toEqual([sessionRoot, validAdditional])
    expect(result.skippedAdditionalPaths).toEqual(['/etc/passwd'])
  })

  test('throws when root path is outside workspace and attached directories', () => {
    const workspaceRoot = resolve('/tmp', 'agent-workspaces')

    expect(() => resolveSearchRoots({
      rootPath: '/etc',
      workspaceRoot,
      attachedRoots: [],
      additionalPaths: [],
    })).toThrow('搜索路径不在允许范围内')
  })

  test('dedupes roots with stable order', () => {
    const workspaceRoot = resolve('/tmp', 'agent-workspaces')
    const sessionRoot = resolve(workspaceRoot, 'workspace-a', 'session-1')
    const workspaceFiles = resolve(workspaceRoot, 'workspace-a', 'workspace-files')
    const attachedRoot = resolve('/tmp', 'external-project')

    const result = resolveSearchRoots({
      rootPath: sessionRoot,
      workspaceRoot,
      attachedRoots: [attachedRoot],
      additionalPaths: [
        workspaceFiles,
        `${workspaceFiles}/`,
        attachedRoot,
        resolve(attachedRoot, '.'),
        sessionRoot,
      ],
    })

    expect(result.scanRoots).toEqual([sessionRoot, workspaceFiles, attachedRoot])
    expect(result.skippedAdditionalPaths).toEqual([])
  })
})
