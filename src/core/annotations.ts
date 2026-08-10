import type { Annotation, AnnotationAnchor, AnnotationRect, TextQuoteAnchor } from './types'
import { normalizeAnchorText } from './text-anchor.js'

export interface CreateAnnotationInput {
  kind: Annotation['kind']
  locator?: string | null
  text?: unknown
  note?: unknown
  color?: string
  rects?: AnnotationRect[]
  page?: number | null
  section?: number | null
  tags?: unknown
  anchor?: AnnotationAnchor
  anchorStatus?: Annotation['anchorStatus']
}

export type AnnotationFilterType = 'all' | 'notes' | 'highlights' | 'pdf' | 'ebook'
export type AnnotationSort = 'newest' | 'oldest' | 'location'

export function normalizeAnnotationTags(value: unknown): string[] {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，]/)
  const tags = source
    .map(tag => String(tag || '').trim().slice(0, 30))
    .filter(Boolean)
  return [...new Set(tags)].slice(0, 10)
}

export function createAnnotation({
  kind,
  locator = null,
  text,
  note = '',
  color = '#f4c95d',
  rects = [],
  page = null,
  section = null,
  tags = [],
  anchor,
  anchorStatus,
}: CreateAnnotationInput): Annotation {
  const createdAt = Date.now()
  return {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 9)}`,
    kind,
    locator,
    page,
    section,
    text: String(text || '').trim().slice(0, 500),
    note: String(note || '').trim().slice(0, 2000),
    color,
    rects,
    createdAt,
    tags: normalizeAnnotationTags(tags),
    ...(anchor ? { anchor } : {}),
    ...(anchor && anchorStatus ? { anchorStatus } : {}),
  }
}

export function normalizeAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) return []
  const result: Annotation[] = []
  for (const valueItem of value) {
    if (!valueItem || typeof valueItem !== 'object') continue
    const item = valueItem as Record<string, unknown>
    const kind = item.kind === 'pdf' || item.kind === 'ebook' ? item.kind : null
    const id = String(item.id || '').trim()
    const page = nonNegativeInteger(item.page, 1)
    const section = nonNegativeInteger(item.section)
    const locator = typeof item.locator === 'string' && item.locator ? item.locator : null
    if (!id || !kind || (kind === 'pdf' ? page == null : !locator)) continue
    const createdAt = finiteNumber(item.createdAt) ?? 0
    const updatedAt = finiteNumber(item.updatedAt)
    const anchor = normalizeAnnotationAnchor(item.anchor, kind, { page, section })
    const anchorStatus = anchor && (item.anchorStatus === 'resolved' || item.anchorStatus === 'unresolved')
      ? item.anchorStatus
      : null
    result.push({
      id,
      kind,
      locator,
      page,
      section,
      text: String(item.text || '').trim().slice(0, 500),
      note: String(item.note || '').trim().slice(0, 2000),
      color: String(item.color || '#f4c95d'),
      rects: normalizeRects(item.rects),
      createdAt,
      ...(updatedAt == null ? {} : { updatedAt }),
      tags: normalizeAnnotationTags(item.tags),
      ...(anchor ? { anchor } : {}),
      ...(anchorStatus ? { anchorStatus } : {}),
    })
  }
  return result
}

export function updateAnnotation(
  value: Annotation[],
  id: string,
  changes: { note?: unknown, tags?: unknown },
  now = Date.now(),
): Annotation[] {
  return value.map(annotation => annotation.id === id
    ? {
        ...annotation,
        note: changes.note === undefined
          ? annotation.note
          : String(changes.note || '').trim().slice(0, 2000),
        tags: changes.tags === undefined
          ? normalizeAnnotationTags(annotation.tags)
          : normalizeAnnotationTags(changes.tags),
        updatedAt: now,
      }
    : annotation)
}

export function filterAnnotations(
  value: Annotation[],
  { query = '', type = 'all' as AnnotationFilterType } = {},
): Annotation[] {
  const term = String(query).trim().toLocaleLowerCase()
  return value.filter(annotation => {
    const hasNote = Boolean(String(annotation.note || '').trim())
    if (type === 'notes' && !hasNote) return false
    if (type === 'highlights' && hasNote) return false
    if (type === 'pdf' && annotation.kind !== 'pdf') return false
    if (type === 'ebook' && annotation.kind !== 'ebook') return false
    if (!term) return true
    const location = annotation.kind === 'pdf' ? `第 ${annotation.page || ''} 页` : '电子书'
    return [annotation.text, annotation.note, annotation.tags?.join(' '), location]
      .some(field => String(field || '').toLocaleLowerCase().includes(term))
  })
}

export function sortAnnotations(value: Annotation[], sort: AnnotationSort = 'newest'): Annotation[] {
  return [...value].sort((left, right) => {
    if (sort === 'location') {
      const leftLocation = left.kind === 'pdf' ? left.page ?? Number.MAX_SAFE_INTEGER : left.section ?? Number.MAX_SAFE_INTEGER
      const rightLocation = right.kind === 'pdf' ? right.page ?? Number.MAX_SAFE_INTEGER : right.section ?? Number.MAX_SAFE_INTEGER
      return leftLocation - rightLocation || left.createdAt - right.createdAt
    }
    const leftTime = left.updatedAt ?? left.createdAt
    const rightTime = right.updatedAt ?? right.createdAt
    return sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime
  })
}

export function excerpt(text: unknown, query: unknown, radius = 42): string {
  const source = String(text || '').replace(/\s+/g, ' ').trim()
  const term = String(query || '').trim()
  if (!term) return source.slice(0, radius * 2)
  const index = source.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
  if (index < 0) return source.slice(0, radius * 2)
  const start = Math.max(0, index - radius)
  const end = Math.min(source.length, index + term.length + radius)
  return `${start ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`
}

export function findTextMatches(text: unknown, query: unknown): number[] {
  const source = String(text || '')
  const term = String(query || '').trim()
  if (!term) return []
  const haystack = source.toLocaleLowerCase()
  const needle = term.toLocaleLowerCase()
  const matches: number[] = []
  let offset = 0
  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset)
    if (index < 0) break
    matches.push(index)
    offset = index + Math.max(needle.length, 1)
  }
  return matches
}

function normalizeAnnotationAnchor(
  value: unknown,
  kind: Annotation['kind'],
  location: { page: number | null, section: number | null },
): AnnotationAnchor | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (source.version !== 1 || source.kind !== kind) return null
  const quote = normalizeTextQuote(source.quote)
  if (!quote) return null
  const textOffset = nonNegativeInteger(source.textOffset)
  if (source.textOffset != null && textOffset == null) return null
  if (kind === 'ebook') {
    const section = nonNegativeInteger(source.section)
    if (source.section != null && section == null) return null
    if (location.section != null && section !== location.section) return null
    const cfi = typeof source.cfi === 'string' && source.cfi ? source.cfi : null
    return { version: 1, kind, section, cfi, textOffset, quote }
  }
  const page = nonNegativeInteger(source.page, 1)
  if (page == null || page !== location.page) return null
  return { version: 1, kind, page, textOffset, quote }
}

function normalizeTextQuote(value: unknown): TextQuoteAnchor | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const exact = String(source.exact || '').trim().slice(0, 500)
  const normalizedExact = String(source.normalizedExact || '').trim().slice(0, 500)
  if (!exact || !normalizedExact || normalizeAnchorText(exact).text !== normalizedExact) return null
  return {
    exact,
    normalizedExact,
    prefix: String(source.prefix || '').slice(-96),
    suffix: String(source.suffix || '').slice(0, 96),
  }
}

function nonNegativeInteger(value: unknown, minimum = 0): number | null {
  const number = finiteNumber(value)
  return number != null && Number.isInteger(number) && number >= minimum ? number : null
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeRects(value: unknown): AnnotationRect[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(rect => {
    if (!rect || typeof rect !== 'object') return []
    const source = rect as Record<string, unknown>
    const left = finiteNumber(source.left)
    const top = finiteNumber(source.top)
    const width = finiteNumber(source.width)
    const height = finiteNumber(source.height)
    return left == null || top == null || width == null || height == null
      ? []
      : [{ left, top, width, height }]
  })
}
