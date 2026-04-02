import * as React from 'react'

interface UseVirtualizedListOptions {
  keys: string[]
  estimateSize: (key: string, index: number) => number
  scrollRef: React.RefObject<HTMLElement | null>
  enabled?: boolean
  overscanPx?: number
}

interface VirtualItem {
  key: string
  index: number
  offset: number
  size: number
}

interface UseVirtualizedListResult {
  enabled: boolean
  totalSize: number
  topPadding: number
  bottomPadding: number
  virtualItems: VirtualItem[]
  measureElement: (key: string) => (element: HTMLElement | null) => void
  scrollToKey: (key: string, align?: 'start' | 'center' | 'end') => void
}

function upperBound(values: number[], target: number): number {
  let left = 0
  let right = values.length
  while (left < right) {
    const mid = (left + right) >> 1
    if (values[mid]! <= target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

export function useVirtualizedList({
  keys,
  estimateSize,
  scrollRef,
  enabled = true,
  overscanPx = 720,
}: UseVirtualizedListOptions): UseVirtualizedListResult {
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0 })
  const [measureVersion, setMeasureVersion] = React.useState(0)
  const measuredHeightsRef = React.useRef(new Map<string, number>())
  const observersRef = React.useRef(new Map<string, ResizeObserver>())
  const measureCallbacksRef = React.useRef(new Map<string, (element: HTMLElement | null) => void>())

  React.useEffect(() => {
    const activeKeys = new Set(keys)

    for (const key of Array.from(measuredHeightsRef.current.keys())) {
      if (!activeKeys.has(key)) measuredHeightsRef.current.delete(key)
    }

    for (const key of Array.from(measureCallbacksRef.current.keys())) {
      if (!activeKeys.has(key)) measureCallbacksRef.current.delete(key)
    }

    for (const [key, observer] of Array.from(observersRef.current.entries())) {
      if (!activeKeys.has(key)) {
        observer.disconnect()
        observersRef.current.delete(key)
      }
    }
  }, [keys])

  const currentScrollElement = scrollRef.current

  React.useEffect(() => {
    const scrollEl = currentScrollElement
    if (!scrollEl) return

    const updateViewport = (): void => {
      const next = { scrollTop: scrollEl.scrollTop, height: scrollEl.clientHeight }
      setViewport((prev) => (prev.scrollTop === next.scrollTop && prev.height === next.height ? prev : next))
    }

    updateViewport()
    scrollEl.addEventListener('scroll', updateViewport, { passive: true })
    const observer = new ResizeObserver(updateViewport)
    observer.observe(scrollEl)

    return () => {
      scrollEl.removeEventListener('scroll', updateViewport)
      observer.disconnect()
    }
  }, [currentScrollElement])

  React.useEffect(() => {
    return () => {
      for (const observer of observersRef.current.values()) observer.disconnect()
      observersRef.current.clear()
      measureCallbacksRef.current.clear()
      measuredHeightsRef.current.clear()
    }
  }, [])

  const { heights, prefix, totalSize, keyToIndex } = React.useMemo(() => {
    const resultHeights = new Array<number>(keys.length)
    const resultPrefix = new Array<number>(keys.length + 1)
    resultPrefix[0] = 0

    const indexMap = new Map<string, number>()

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!
      indexMap.set(key, i)

      const measured = measuredHeightsRef.current.get(key)
      const estimated = estimateSize(key, i)
      const size = measured ?? (Number.isFinite(estimated) ? Math.max(24, estimated) : 24)

      resultHeights[i] = size
      resultPrefix[i + 1] = resultPrefix[i]! + size
    }

    return {
      heights: resultHeights,
      prefix: resultPrefix,
      totalSize: resultPrefix[keys.length] ?? 0,
      keyToIndex: indexMap,
    }
  }, [keys, estimateSize, measureVersion])

  const { startIndex, endIndex } = React.useMemo(() => {
    if (!enabled || keys.length === 0) {
      return { startIndex: 0, endIndex: keys.length }
    }

    const start = Math.max(0, upperBound(prefix, viewport.scrollTop - overscanPx) - 1)
    const end = Math.min(
      keys.length,
      Math.max(start + 1, upperBound(prefix, viewport.scrollTop + viewport.height + overscanPx))
    )

    return { startIndex: start, endIndex: end }
  }, [enabled, keys.length, overscanPx, prefix, viewport.scrollTop, viewport.height])

  const virtualItems = React.useMemo(() => {
    const items: VirtualItem[] = []
    for (let i = startIndex; i < endIndex; i++) {
      const key = keys[i]!
      items.push({
        key,
        index: i,
        offset: prefix[i] ?? 0,
        size: heights[i] ?? 0,
      })
    }
    return items
  }, [endIndex, heights, keys, prefix, startIndex])

  const topPadding = enabled && startIndex > 0 ? (prefix[startIndex] ?? 0) : 0
  const bottomPadding = enabled ? Math.max(0, totalSize - (prefix[endIndex] ?? 0)) : 0

  const measureElement = React.useCallback((key: string) => {
    const existing = measureCallbacksRef.current.get(key)
    if (existing) return existing

    const callback = (element: HTMLElement | null): void => {
      const prevObserver = observersRef.current.get(key)
      if (prevObserver) {
        prevObserver.disconnect()
        observersRef.current.delete(key)
      }

      if (!element) return

      const commitHeight = (height: number): void => {
        if (!Number.isFinite(height) || height <= 0) return
        const next = Math.round(height * 100) / 100
        const prev = measuredHeightsRef.current.get(key)
        if (prev != null && Math.abs(prev - next) < 0.5) return
        measuredHeightsRef.current.set(key, next)
        setMeasureVersion((v) => v + 1)
      }

      commitHeight(element.getBoundingClientRect().height)

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        commitHeight(entry.contentRect.height)
      })
      observer.observe(element)
      observersRef.current.set(key, observer)
    }

    measureCallbacksRef.current.set(key, callback)
    return callback
  }, [])

  const scrollToKey = React.useCallback((key: string, align: 'start' | 'center' | 'end' = 'center'): void => {
    const scrollEl = scrollRef.current
    const index = keyToIndex.get(key)
    if (!scrollEl || index == null) return

    const start = prefix[index] ?? 0
    const end = prefix[index + 1] ?? start
    let target = start

    if (align === 'center') {
      target = start - (scrollEl.clientHeight - (end - start)) / 2
    } else if (align === 'end') {
      target = end - scrollEl.clientHeight
    }

    const maxTop = Math.max(0, totalSize - scrollEl.clientHeight)
    scrollEl.scrollTo({
      top: Math.max(0, Math.min(maxTop, target)),
      behavior: 'smooth',
    })
  }, [keyToIndex, prefix, scrollRef, totalSize])

  return {
    enabled,
    totalSize,
    topPadding,
    bottomPadding,
    virtualItems,
    measureElement,
    scrollToKey,
  }
}
