import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import { isPathWithinRoot, resolvePathWithinRoot } from './config-paths'

describe('config-paths security helpers', () => {
  test('isPathWithinRoot correctly checks path boundaries', () => {
    const root = resolve('/tmp', 'proma-root')
    const inside = join(root, 'workspace', 'file.txt')
    const sibling = `${root}-other`
    const outside = join(root, '..', 'escape')

    expect(isPathWithinRoot(inside, root)).toBe(true)
    expect(isPathWithinRoot(root, root)).toBe(true)
    expect(isPathWithinRoot(sibling, root)).toBe(false)
    expect(isPathWithinRoot(outside, root)).toBe(false)
  })

  test('resolvePathWithinRoot rejects path traversal', () => {
    const root = resolve('/tmp', 'proma-root')

    expect(resolvePathWithinRoot(root, 'attachments', 'a.txt')).toBe(resolve(root, 'attachments', 'a.txt'))
    expect(() => resolvePathWithinRoot(root, '../escape.txt')).toThrow()
  })
})
