import type { TextQuoteAnchor } from './types'

export interface NormalizedAnchorText {
  text: string
  offsets: number[]
}

export interface ResolvedTextAnchor {
  start: number
  end: number
  confidence: number
  method: 'offset' | 'quote' | 'fuzzy'
}

export interface FuzzyAnchorOptions {
  minimumConfidence?: number
  minimumLead?: number
  searchRadius?: number
}

export function normalizeAnchorText(value: unknown): NormalizedAnchorText {
  const source = String(value || '')
  let text = ''
  const offsets: number[] = []
  let whitespaceStart = -1
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (/\s/u.test(character)) {
      if (text && !text.endsWith(' ') && whitespaceStart < 0) whitespaceStart = index
      continue
    }
    if (whitespaceStart >= 0) {
      text += ' '
      offsets.push(whitespaceStart)
      whitespaceStart = -1
    }
    text += character
    offsets.push(index)
  }
  return { text, offsets }
}

export function createTextQuoteAnchor(
  source: string,
  start: number,
  end: number,
  contextLength = 48,
): TextQuoteAnchor {
  const normalized = normalizeAnchorText(source)
  const normalizedStart = normalizedIndexAtOrAfter(normalized.offsets, Math.max(0, start))
  const normalizedEnd = normalizedIndexAtOrAfter(normalized.offsets, Math.max(start, end))
  const boundedEnd = Math.min(normalizedEnd, normalizedStart + 500)
  const normalizedExact = normalized.text.slice(normalizedStart, boundedEnd).trim()
  return {
    exact: normalizedExact,
    normalizedExact,
    prefix: normalized.text.slice(Math.max(0, normalizedStart - contextLength), normalizedStart),
    suffix: normalized.text.slice(boundedEnd, boundedEnd + contextLength),
  }
}

export function resolveTextQuoteAnchor(
  source: string,
  anchor: TextQuoteAnchor,
  preferredOffset: number | null = null,
): ResolvedTextAnchor | null {
  const normalized = normalizeAnchorText(source)
  const needle = String(anchor?.normalizedExact || '').trim()
  if (!needle || !normalized.text) return null

  if (preferredOffset != null && Number.isFinite(preferredOffset)) {
    const preferredIndex = normalizedIndexAtOrAfter(normalized.offsets, Math.max(0, preferredOffset))
    if (normalized.text.slice(preferredIndex, preferredIndex + needle.length) === needle) {
      return toSourceResolution(normalized.offsets, preferredIndex, needle.length, 'offset')
    }
  }

  const candidates: Array<{ index: number, score: number }> = []
  let from = 0
  while (from <= normalized.text.length - needle.length) {
    const index = normalized.text.indexOf(needle, from)
    if (index < 0) break
    const prefix = commonSuffixAt(normalized.text, index, anchor.prefix || '')
    const suffix = commonPrefixAt(normalized.text, index + needle.length, anchor.suffix || '')
    const contextSize = (anchor.prefix?.length || 0) + (anchor.suffix?.length || 0)
    const score = contextSize ? (prefix + suffix) / contextSize : 0
    candidates.push({ index, score })
    from = index + Math.max(needle.length, 1)
  }
  if (!candidates.length) return null
  if (candidates.length === 1) {
    return toSourceResolution(normalized.offsets, candidates[0]!.index, needle.length, 'quote')
  }
  candidates.sort((left, right) => right.score - left.score)
  if (candidates[0]!.score <= 0 || candidates[0]!.score === candidates[1]!.score) return null
  return toSourceResolution(normalized.offsets, candidates[0]!.index, needle.length, 'quote')
}

export function resolveChangedTextQuoteAnchor(
  source: string,
  anchor: TextQuoteAnchor,
  preferredOffset: number | null = null,
  options: FuzzyAnchorOptions = {},
): ResolvedTextAnchor | null {
  const exact = resolveTextQuoteAnchor(source, anchor, preferredOffset)
  if (exact) return exact

  const normalized = normalizeAnchorText(source)
  const needle = String(anchor?.normalizedExact || '').trim()
  if (!needle || !normalized.text) return null
  const minimumConfidence = options.minimumConfidence ?? 0.86
  const minimumLead = options.minimumLead ?? 0.08
  const searchRadius = options.searchRadius ?? 4096
  const preferredIndex = preferredOffset == null
    ? null
    : normalizedIndexAtOrAfter(normalized.offsets, Math.max(0, preferredOffset))
  const regionStart = preferredIndex == null ? 0 : Math.max(0, preferredIndex - searchRadius)
  const regionEnd = preferredIndex == null
    ? normalized.text.length
    : Math.min(normalized.text.length, preferredIndex + needle.length + searchRadius)
  const maxDelta = Math.max(1, Math.min(32, Math.ceil(needle.length * 0.14)))
  const starts = fuzzyCandidateStarts(
    normalized.text,
    needle,
    regionStart,
    regionEnd,
    maxDelta,
    preferredIndex,
  )
  const contextSize = (anchor.prefix?.length || 0) + (anchor.suffix?.length || 0)
  const minimumQuoteScore = contextSize
    ? Math.max(0.6, (minimumConfidence - 0.2) / 0.8)
    : minimumConfidence
  const candidates: Array<{ start: number, length: number, score: number }> = []
  for (const start of starts) {
    const minimumLength = Math.max(1, needle.length - maxDelta)
    const maximumLength = Math.min(normalized.text.length - start, needle.length + maxDelta)
    for (let length = minimumLength; length <= maximumLength; length += 1) {
      const maximumDistance = Math.floor(Math.max(needle.length, length) * (1 - minimumQuoteScore))
      if (Math.abs(needle.length - length) > maximumDistance) continue
      const candidate = normalized.text.slice(start, start + length)
      const distance = boundedLevenshtein(needle, candidate, maximumDistance)
      if (distance > maximumDistance) continue
      const quoteScore = 1 - distance / Math.max(needle.length, length)
      const prefix = commonSuffixAt(normalized.text, start, anchor.prefix || '')
      const suffix = commonPrefixAt(normalized.text, start + length, anchor.suffix || '')
      const contextScore = contextSize ? (prefix + suffix) / contextSize : 0
      const score = contextSize ? quoteScore * 0.8 + contextScore * 0.2 : quoteScore
      if (score >= minimumConfidence) candidates.push({ start, length, score })
    }
  }
  if (!candidates.length) return null
  candidates.sort((left, right) => right.score - left.score || left.start - right.start)
  const distinct: typeof candidates = []
  for (const candidate of candidates) {
    const cluster = distinct.find(item => Math.abs(item.start - candidate.start) <= maxDelta * 2 + 2)
    if (!cluster) distinct.push(candidate)
  }
  distinct.sort((left, right) => right.score - left.score || left.start - right.start)
  const winner = distinct[0]!
  const runnerUp = distinct[1]
  if (winner.score < minimumConfidence || (runnerUp && winner.score - runnerUp.score < minimumLead)) return null
  const result = toSourceResolution(normalized.offsets, winner.start, winner.length, 'fuzzy')
  return { ...result, confidence: winner.score }
}

function fuzzyCandidateStarts(
  source: string,
  needle: string,
  regionStart: number,
  regionEnd: number,
  maxDelta: number,
  preferredIndex: number | null,
): number[] {
  const starts = new Set<number>()
  const addAround = (value: number, radius = maxDelta) => {
    for (let shift = -radius; shift <= radius; shift += 1) {
      const start = value + shift
      if (start >= regionStart && start < regionEnd) starts.add(start)
    }
  }
  if (preferredIndex != null) addAround(preferredIndex, maxDelta * 2)
  if (needle.length < 8) {
    for (let start = regionStart; start < regionEnd; start += 1) starts.add(start)
    return [...starts]
  }
  const seedLength = Math.max(3, Math.min(12, Math.floor(needle.length / 4)))
  const lastOffset = needle.length - seedLength
  const offsets = [...new Set([0, Math.floor(lastOffset / 3), Math.floor(lastOffset * 2 / 3), lastOffset])]
  for (const offset of offsets) {
    const seed = needle.slice(offset, offset + seedLength)
    let from = regionStart
    while (from < regionEnd) {
      const index = source.indexOf(seed, from)
      if (index < 0 || index >= regionEnd) break
      addAround(index - offset)
      from = index + Math.max(seed.length, 1)
    }
  }
  return [...starts]
}

function boundedLevenshtein(left: string, right: string, maximumDistance: number): number {
  if (Math.abs(left.length - right.length) > maximumDistance) return maximumDistance + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array<number>(right.length + 1)
    current[0] = leftIndex
    let rowMinimum = current[0]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      )
      rowMinimum = Math.min(rowMinimum, current[rightIndex]!)
    }
    if (rowMinimum > maximumDistance) return maximumDistance + 1
    previous = current
  }
  return previous[right.length]!
}

function normalizedIndexAtOrAfter(offsets: number[], sourceOffset: number): number {
  const index = offsets.findIndex(offset => offset >= sourceOffset)
  return index < 0 ? offsets.length : index
}

function toSourceResolution(
  offsets: number[],
  normalizedStart: number,
  length: number,
  method: ResolvedTextAnchor['method'],
): ResolvedTextAnchor {
  const normalizedEnd = normalizedStart + length
  return {
    start: offsets[normalizedStart]!,
    end: offsets[normalizedEnd - 1]! + 1,
    confidence: 1,
    method,
  }
}

function commonPrefixAt(source: string, start: number, context: string): number {
  const length = Math.min(source.length - start, context.length)
  let count = 0
  while (count < length && source[start + count] === context[count]) count += 1
  return count
}

function commonSuffixAt(source: string, end: number, context: string): number {
  const length = Math.min(end, context.length)
  let count = 0
  while (count < length && source[end - count - 1] === context[context.length - count - 1]) count += 1
  return count
}
