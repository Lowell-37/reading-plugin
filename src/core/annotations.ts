import type { Annotation, AnnotationRect } from './types'

export interface CreateAnnotationInput {
  kind: Annotation['kind']
  locator?: string | null
  text?: unknown
  note?: unknown
  color?: string
  rects?: AnnotationRect[]
  page?: number | null
  section?: number | null
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
  }
}

export function normalizeAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Annotation => Boolean(
    item && typeof item === 'object'
    && 'id' in item && item.id
    && 'kind' in item && item.kind
    && (('locator' in item && item.locator) || ('page' in item && item.page)),
  ))
}

export type AnnotationFilterType = 'all' | 'notes' | 'highlights' | 'pdf' | 'ebook'

export function updateAnnotation(
  value: Annotation[],
  id: string,
  changes: { note?: unknown },
  now = Date.now(),
): Annotation[] {
  return value.map(annotation => annotation.id === id
    ? {
        ...annotation,
        note: changes.note === undefined
          ? annotation.note
          : String(changes.note || '').trim().slice(0, 2000),
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
    return [annotation.text, annotation.note, location]
      .some(field => String(field || '').toLocaleLowerCase().includes(term))
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
