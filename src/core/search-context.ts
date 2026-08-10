import { normalizeAnchorText } from './text-anchor.js'

export interface SearchContext {
  text: string
  start: number
  end: number
  matchStart: number
  matchEnd: number
}

export interface SearchMatch {
  start: number
  end: number
}

const SENTENCE_BOUNDARY = /[.!?。！？]/u

export function createSearchContext(
  sourceValue: unknown,
  matchStartValue: number,
  matchLengthValue: number,
  radius = 60,
): SearchContext {
  const source = String(sourceValue || '')
  const matchStart = Math.max(0, Math.min(source.length, Number(matchStartValue) || 0))
  const matchLength = Math.max(0, Number(matchLengthValue) || 0)
  const matchEnd = Math.min(source.length, matchStart + matchLength)
  const previousBoundary = findPreviousBoundary(source, matchStart)
  const nextBoundary = matchEnd > matchStart && SENTENCE_BOUNDARY.test(source[matchEnd - 1]!)
    ? matchEnd - 1
    : findNextBoundary(source, matchEnd)
  let start = previousBoundary >= 0 ? previousBoundary + 1 : Math.max(0, matchStart - radius)
  let end = nextBoundary >= 0 ? nextBoundary + 1 : Math.min(source.length, matchEnd + radius)
  while (start < matchStart && /\s/u.test(source[start]!)) start += 1
  while (end > matchEnd && /\s/u.test(source[end - 1]!)) end -= 1
  const raw = source.slice(start, end)
  const normalized = normalizeAnchorText(raw)
  return {
    text: normalized.text,
    start,
    end,
    matchStart: normalizedIndexAtOrAfter(normalized.offsets, matchStart - start),
    matchEnd: normalizedIndexAtOrAfter(normalized.offsets, matchEnd - start),
  }
}

export function findSearchMatches(sourceValue: unknown, queryValue: unknown): SearchMatch[] {
  return [...iterateSearchMatches(sourceValue, queryValue)]
}

export function* iterateSearchMatches(sourceValue: unknown, queryValue: unknown): Generator<SearchMatch> {
  const source = String(sourceValue ?? '')
  const query = String(queryValue ?? '')
  const foldedQuery = foldCase(query).text
  if (!foldedQuery) return
  const foldedSource = foldCase(source)
  let fromIndex = 0
  while (fromIndex <= foldedSource.text.length - foldedQuery.length) {
    const foldedStart = foldedSource.text.indexOf(foldedQuery, fromIndex)
    if (foldedStart < 0) break
    const foldedEnd = foldedStart + foldedQuery.length
    yield {
      start: foldedSource.starts[foldedStart] ?? source.length,
      end: foldedSource.ends[foldedEnd - 1] ?? source.length,
    }
    fromIndex = foldedEnd
  }
}

function foldCase(source: string): { text: string, starts: number[], ends: number[] } {
  const text = source.toLowerCase()
  let sourceOffset = 0
  const starts: number[] = []
  const ends: number[] = []
  for (const character of source) {
    const folded = character.toLowerCase()
    const sourceEnd = sourceOffset + character.length
    for (let index = 0; index < folded.length; index += 1) {
      starts.push(sourceOffset)
      ends.push(sourceEnd)
    }
    sourceOffset = sourceEnd
  }
  if (starts.length !== text.length) return foldCaseByPrefixes(source, text)
  return { text, starts, ends }
}

function foldCaseByPrefixes(source: string, text: string): { text: string, starts: number[], ends: number[] } {
  const starts: number[] = []
  const ends: number[] = []
  let sourceOffset = 0
  let foldedOffset = 0
  for (const character of source) {
    const sourceEnd = sourceOffset + character.length
    const foldedEnd = source.slice(0, sourceEnd).toLowerCase().length
    while (foldedOffset < foldedEnd) {
      starts.push(sourceOffset)
      ends.push(sourceEnd)
      foldedOffset += 1
    }
    sourceOffset = sourceEnd
  }
  return { text, starts, ends }
}

function findPreviousBoundary(source: string, before: number): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (SENTENCE_BOUNDARY.test(source[index]!)) return index
  }
  return -1
}

function findNextBoundary(source: string, after: number): number {
  for (let index = after; index < source.length; index += 1) {
    if (SENTENCE_BOUNDARY.test(source[index]!)) return index
  }
  return -1
}

function normalizedIndexAtOrAfter(offsets: number[], sourceOffset: number): number {
  const index = offsets.findIndex(offset => offset >= sourceOffset)
  return index < 0 ? offsets.length : index
}
