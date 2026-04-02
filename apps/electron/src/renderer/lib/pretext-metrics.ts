import { layout, prepare, type PreparedText } from '@chenglou/pretext'

type WhiteSpaceMode = 'normal' | 'pre-wrap'

const PREPARED_CACHE_MAX_SIZE = 2000
const preparedCache = new Map<string, PreparedText>()

export interface EstimateTextLayoutInput {
  text: string
  maxWidth: number
  font: string
  lineHeight: number
  whiteSpace?: WhiteSpaceMode
}

export interface EstimateTextLayoutResult {
  lineCount: number
  height: number
  source: 'pretext' | 'fallback'
}

function buildPreparedCacheKey(text: string, font: string, whiteSpace: WhiteSpaceMode): string {
  return `${font}\u0000${whiteSpace}\u0000${text}`
}

function setPreparedCache(key: string, value: PreparedText): void {
  if (preparedCache.has(key)) {
    preparedCache.delete(key)
  }
  preparedCache.set(key, value)
  if (preparedCache.size <= PREPARED_CACHE_MAX_SIZE) return

  const oldestKey = preparedCache.keys().next().value
  if (oldestKey) {
    preparedCache.delete(oldestKey)
  }
}

function getPreparedText(text: string, font: string, whiteSpace: WhiteSpaceMode): PreparedText {
  const cacheKey = buildPreparedCacheKey(text, font, whiteSpace)
  const cached = preparedCache.get(cacheKey)
  if (cached) return cached

  const prepared = prepare(text, font, { whiteSpace })
  setPreparedCache(cacheKey, prepared)
  return prepared
}

function fallbackEstimate(text: string, lineHeight: number): EstimateTextLayoutResult {
  const hardBreakLines = text.split('\n').length
  const lineCount = Math.max(1, hardBreakLines)
  return {
    lineCount,
    height: lineCount * lineHeight,
    source: 'fallback',
  }
}

export function estimateTextLayout({
  text,
  maxWidth,
  font,
  lineHeight,
  whiteSpace = 'normal',
}: EstimateTextLayoutInput): EstimateTextLayoutResult {
  const normalizedWidth = Number.isFinite(maxWidth) ? Math.max(0, maxWidth) : 0
  const normalizedLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 24

  if (!text) {
    return {
      lineCount: 1,
      height: normalizedLineHeight,
      source: 'pretext',
    }
  }

  if (normalizedWidth <= 0 || !font) {
    return fallbackEstimate(text, normalizedLineHeight)
  }

  try {
    const prepared = getPreparedText(text, font, whiteSpace)
    const result = layout(prepared, normalizedWidth, normalizedLineHeight)
    const lineCount = Math.max(1, result.lineCount)

    return {
      lineCount,
      height: result.height,
      source: 'pretext',
    }
  } catch {
    return fallbackEstimate(text, normalizedLineHeight)
  }
}

export function clearPreparedTextCache(): void {
  preparedCache.clear()
}
