// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { clearPdfSearchMarks, searchRenderedPdf } from '../entrypoints/reader/pdf-search'

afterEach(() => {
  document.body.replaceChildren()
})

describe('rendered PDF search', () => {
  test('finds rendered pages, returns sentence context, and counts unavailable pages', async () => {
    const pages = new Map([
      [1, textLayer('Before. First searchable sentence. After.')],
      [2, textLayer('Another searchable result!')],
    ])

    const outcome = await searchRenderedPdf({
      query: 'searchable',
      pageCount: 3,
      readTextLayer: page => pages.get(page) ?? null,
      signal: new AbortController().signal,
    })

    expect(outcome).toMatchObject({
      query: 'searchable',
      total: 2,
      unavailablePages: 1,
    })
    expect(outcome.results).toEqual([
      { page: 1, start: 14, end: 24, context: 'First searchable sentence.' },
      { page: 2, start: 8, end: 18, context: 'Another searchable result!' },
    ])
    expect(document.querySelectorAll('.pdf-search-match')).toHaveLength(2)
  })

  test('finds a case-insensitive match spanning adjacent text spans and marks both', async () => {
    const layer = textLayer('Prefix ', 'Search', 'ABLE suffix.')

    const outcome = await searchRenderedPdf({
      query: 'searchable',
      pageCount: 1,
      readTextLayer: () => layer,
      signal: new AbortController().signal,
    })

    expect(outcome.results).toEqual([
      { page: 1, start: 7, end: 17, context: 'Prefix SearchABLE suffix.' },
    ])
    expect(layer.querySelectorAll('.pdf-search-match')).toHaveLength(2)
  })

  test('counts every match but returns at most 300 results', async () => {
    const layer = textLayer(Array.from({ length: 301 }, () => 'hit').join(' '))

    const outcome = await searchRenderedPdf({
      query: 'hit',
      pageCount: 1,
      readTextLayer: () => layer,
      signal: new AbortController().signal,
    })

    expect(outcome.total).toBe(301)
    expect(outcome.results).toHaveLength(300)
    expect(layer.querySelectorAll('.pdf-search-match')).toHaveLength(1)
  })

  test('empty queries clear old marks and return no results', async () => {
    const layer = textLayer('searchable')
    layer.firstElementChild?.classList.add('pdf-search-match')

    const outcome = await searchRenderedPdf({
      query: '   ',
      pageCount: 1,
      readTextLayer: () => layer,
      signal: new AbortController().signal,
    })

    expect(outcome).toEqual({ query: '', total: 0, results: [], unavailablePages: 0 })
    expect(layer.querySelectorAll('.pdf-search-match')).toHaveLength(0)
  })

  test('aborts between pages and removes partial marks', async () => {
    const controller = new AbortController()
    const first = textLayer('searchable first')
    const second = textLayer('searchable second')

    await expect(searchRenderedPdf({
      query: 'searchable',
      pageCount: 2,
      readTextLayer: page => page === 1 ? first : second,
      signal: controller.signal,
      yieldControl: async () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(document.querySelectorAll('.pdf-search-match')).toHaveLength(0)
  })

  test('does not clear marks added by a newer search when an older search aborts', async () => {
    const controller = new AbortController()
    const layer = textLayer('alpha beta')
    let releaseOlderYield!: () => void
    const olderYield = new Promise<void>(resolve => {
      releaseOlderYield = resolve
    })

    const older = searchRenderedPdf({
      query: 'alpha',
      pageCount: 1,
      readTextLayer: () => layer,
      signal: controller.signal,
      yieldControl: () => olderYield,
    })

    expect(layer.querySelector('.pdf-search-match')).not.toBeNull()

    await searchRenderedPdf({
      query: 'beta',
      pageCount: 1,
      readTextLayer: () => layer,
      signal: new AbortController().signal,
    })

    controller.abort()
    releaseOlderYield()
    await expect(older).rejects.toMatchObject({ name: 'AbortError' })

    expect(layer.querySelectorAll('.pdf-search-match')).toHaveLength(1)
    expect(layer.querySelector('.pdf-search-match')?.textContent).toBe('alpha beta')
  })

  test('treats a detached text layer as unavailable', async () => {
    const detached = textLayer('searchable but stale')
    detached.remove()

    const outcome = await searchRenderedPdf({
      query: 'searchable',
      pageCount: 1,
      readTextLayer: () => detached,
      signal: new AbortController().signal,
    })

    expect(outcome).toEqual({ query: 'searchable', total: 0, results: [], unavailablePages: 1 })
  })

  test('clears search marks without modifying annotation overlays', () => {
    const page = document.createElement('section')
    const layer = textLayer('searchable')
    layer.firstElementChild?.classList.add('pdf-search-match')
    const annotation = document.createElement('div')
    annotation.className = 'pdf-annotation-layer'
    const annotationSpan = document.createElement('span')
    annotationSpan.classList.add('pdf-search-match')
    annotation.append(annotationSpan)
    page.append(layer, annotation)
    document.body.append(page)

    clearPdfSearchMarks(page)

    expect(layer.querySelectorAll('.pdf-search-match')).toHaveLength(0)
    expect(page.querySelectorAll('.pdf-annotation-layer span')).toHaveLength(1)
    expect(annotationSpan.classList.contains('pdf-search-match')).toBe(true)
  })
})

function textLayer(...texts: string[]) {
  const layer = document.createElement('div')
  layer.className = 'textLayer'
  for (const text of texts) {
    const span = document.createElement('span')
    span.textContent = text
    layer.append(span)
  }
  document.body.append(layer)
  return layer
}
