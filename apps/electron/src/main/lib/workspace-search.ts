import { isAbsolute, relative, resolve } from 'node:path'

export interface ResolveSearchRootsInput {
  rootPath: string
  workspaceRoot: string
  attachedRoots: string[]
  additionalPaths?: string[]
}

export interface ResolveSearchRootsResult {
  /** 最终扫描根路径，按输入顺序稳定去重，rootPath 永远在首位 */
  scanRoots: string[]
  /** 被安全策略跳过的 additionalPaths（不会中断搜索） */
  skippedAdditionalPaths: string[]
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const safeTarget = resolve(targetPath)
  const safeRoot = resolve(rootPath)
  const rel = relative(safeRoot, safeTarget)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 解析文件搜索的根路径集合
 *
 * 规则：
 * - rootPath 必须位于工作区根目录或任一附加目录内，否则抛错
 * - additionalPaths 非法时只跳过，不抛错
 * - 返回 roots 保持稳定顺序并去重
 */
export function resolveSearchRoots(input: ResolveSearchRootsInput): ResolveSearchRootsResult {
  const safeWorkspaceRoot = resolve(input.workspaceRoot)
  const safeRoot = resolve(input.rootPath)
  const safeAttachedRoots = input.attachedRoots.map((root) => resolve(root))

  const isAllowedPath = (targetPath: string): boolean => {
    const safeTarget = resolve(targetPath)
    return (
      isPathInsideRoot(safeTarget, safeWorkspaceRoot)
      || safeAttachedRoots.some((root) => isPathInsideRoot(safeTarget, root))
    )
  }

  if (!isAllowedPath(safeRoot)) {
    throw new Error('搜索路径不在允许范围内')
  }

  const seen = new Set<string>()
  const scanRoots: string[] = []
  const skippedAdditionalPaths: string[] = []

  const appendRoot = (candidatePath: string): void => {
    const safeCandidate = resolve(candidatePath)
    if (seen.has(safeCandidate)) return
    seen.add(safeCandidate)
    scanRoots.push(safeCandidate)
  }

  appendRoot(safeRoot)

  for (const addPath of input.additionalPaths ?? []) {
    if (!addPath || !addPath.trim()) continue
    const safeAddPath = resolve(addPath)
    if (!isAllowedPath(safeAddPath)) {
      skippedAdditionalPaths.push(addPath)
      continue
    }
    appendRoot(safeAddPath)
  }

  return { scanRoots, skippedAdditionalPaths }
}
