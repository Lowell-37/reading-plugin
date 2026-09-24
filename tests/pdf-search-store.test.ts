// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PdfSearchOptions, PdfSearchOutcome } from '../entrypoints/reader/pdf-search'
import type {
  PdfSessionCallbacks,
  PdfSessionPort,
  PdfSessionPortFactory,
  PdfSessionSnapshot,
} from '../entrypoints/reader/pdf-session-port'
import { createPdfSearchStore } from '../entrypoints/reader/stores/pdf-search'
import { createPdfSessionStore } from '../entrypoints/reader/stores/pdf-session'
import type { BookRecord } from '../src/core/types'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('PDF search store', () => {
  test('publishes searching then ready and navigates to a result page', async () => {
    const harness = readyHarness()
    const observed: string[] = []
    harness.search.$subscribe((_mutation, state) => observed.push(state.status), { flush: 'sync' })

    await harness.search.run('needle')

    expect(observed).toContain('searching')
    expect(harness.search.$state).toMatchObject({
      query: 'needle',
      status: 'ready',
      total: 1,
      unavailablePages: 1,
      results: [{ page: 4, start: 2, end: 8, context: 'A needle sentence.' }],
    })
    await harness.search.goToResult(harness.search.results[0]!)
    expect(harness.pdfPort.goToPages).toEqual([4])
  })

  test('empty input resets state and removes only search marks', async () => {
    const harness = readyHarness()
    const mark = document.createElement('span')
    mark.className = 'pdf-search-match'
    const annotation = document.createElement('div')
    annotation.className = 'pdf-annotation-layer'
    harness.root.append(mark, annotation)
    await harness.search.run('needle')

    await harness.search.run('   ')

    expect(harness.search.$state).toMatchObject({
      query: '',
      status: 'idle',
      results: [],
      total: 0,
      unavailablePages: 0,
      error: null,
    })
    expect(harness.root.querySelector('.pdf-search-match')).toBeNull()
    expect(harness.root.querySelector('.pdf-annotation-layer')).toBe(annotation)
  })

  test('a second run aborts the first and late completion cannot replace current results', async () => {
    const pending: Array<{ options: PdfSearchOptions, resolve(value: PdfSearchOutcome): void }> = []
    const harness = readyHarness(options => new Promise(resolve => pending.push({ options, resolve })))

    const first = harness.search.run('first')
    const second = harness.search.run('second')
    expect(pending[0]!.options.signal.aborted).toBe(true)
    pending[1]!.resolve(outcome('second', 2))
    await second
    pending[0]!.resolve(outcome('first', 1))
    await first

    expect(harness.search.query).toBe('second')
    expect(harness.search.results.map(result => result.page)).toEqual([2])
  })

  test('ignores a result after the PDF generation changes', async () => {
    let resolve!: (value: PdfSearchOutcome) => void
    const harness = readyHarness(() => new Promise(next => { resolve = next }))
    const running = harness.search.run('old')

    await harness.pdf.open(record('replacement.pdf'), {})
    harness.pdfPort.emit(snapshot(2))
    resolve(outcome('old', 1))
    await running

    expect(harness.search.results).toEqual([])
  })

  test.each([
    { generation: 2, status: 'ready' as const, zoom: 1, recordId: 'book.pdf' },
    { generation: 1, status: 'error' as const, zoom: 1, recordId: 'book.pdf' },
    { generation: 1, status: 'ready' as const, zoom: 1.2, recordId: 'book.pdf' },
    { generation: 1, status: 'ready' as const, zoom: 1, recordId: 'replacement.pdf' },
  ])('clears results when session identity changes: $status/$generation/$zoom/$recordId', async next => {
    const harness = readyHarness()
    harness.search.synchronizeSession({ generation: 1, status: 'ready', zoom: 1, recordId: 'book.pdf' })
    await harness.search.run('needle')

    harness.search.synchronizeSession(next)

    expect(harness.search.status).toBe('idle')
    expect(harness.search.results).toEqual([])
  })
})

function readyHarness(search = async (_options: PdfSearchOptions) => outcome('needle', 4)) {
  const pinia = createPinia()
  const pdfPort = fakePdfPort()
  const pdf = createPdfSessionStore(pdfPort.factory)(pinia)
  const root = document.createElement('div')
  document.body.append(root)
  const useSearch = createPdfSearchStore(search)
  const searchInstance = useSearch(pinia)
  searchInstance.attachRoot(root)
  void pdf.open(record('book.pdf'), {})
  pdfPort.emit(snapshot(1))
  searchInstance.synchronizeSession({ generation: 1, status: 'ready', zoom: 1, recordId: 'book.pdf' })
  return { pdf, pdfPort, root, search: searchInstance }
}

function fakePdfPort() {
  let callbacks: PdfSessionCallbacks | null = null
  const goToPages: number[] = []
  const port: PdfSessionPort = {
    async open() {},
    async close() {},
    async goTo(page) { goToPages.push(page) },
    async navigate() {},
    async setZoom() {},
    async flushProgress() {},
    readRenderedTextLayer() { return null },
    destroy() {},
  }
  const factory: PdfSessionPortFactory = next => {
    callbacks = next
    return port
  }
  return {
    factory,
    goToPages,
    emit(value: PdfSessionSnapshot) { callbacks?.onSnapshot(value) },
  }
}

function outcome(query: string, page: number): PdfSearchOutcome {
  return {
    query,
    total: 1,
    unavailablePages: 1,
    results: [{ page, start: 2, end: 8, context: 'A needle sentence.' }],
  }
}

function record(name: string): BookRecord {
  return {
    id: name,
    name,
    type: 'application/pdf',
    size: 4,
    lastModified: 1,
    format: 'pdf',
    blob: new Blob(['pdf']),
    openedAt: 1,
  }
}

function snapshot(generation: number): PdfSessionSnapshot {
  return {
    status: 'ready',
    title: 'PDF',
    outline: [],
    page: 1,
    pageCount: 8,
    zoom: 1,
    progress: 0,
    error: null,
    generation,
  }
}
