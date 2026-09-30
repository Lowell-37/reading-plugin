import { createPinia } from 'pinia'
import { describe, expect, test } from 'vitest'
import type {
  PdfSessionCallbacks,
  PdfSessionError,
  PdfSessionPort,
  PdfSessionPortFactory,
  PdfSessionSnapshot,
  PdfOutlineItem,
} from '../entrypoints/reader/pdf-session-port'
import { createPdfSessionStore } from '../entrypoints/reader/stores/pdf-session'
import { useReaderStore } from '../entrypoints/reader/stores/reader'
import type { BookRecord } from '../src/core/types'

describe('PDF session store', () => {
  test('proxies current rendered-page notifications without engine objects', async () => {
    const fake = createFakePort()
    const useStore = createPdfSessionStore(fake.factory)
    const store = useStore(createPinia())
    const pages: Array<{ page: number, generation: number }> = []
    store.onPageRendered((page, generation) => pages.push({ page, generation }))
    await store.open(record('rendered.pdf'), {})

    fake.emitRendered(2, 1)
    fake.emitRendered(3, 99)

    expect(pages).toEqual([{ page: 2, generation: 1 }])
  })
  test('projects only the latest generation into PDF and reader state', async () => {
    const fake = createFakePort()
    const useStore = createPdfSessionStore(fake.factory)
    const pinia = createPinia()
    const store = useStore(pinia)
    const reader = useReaderStore(pinia)

    await store.open(record('first.pdf'), {})
    fake.emit(snapshot(1, { title: 'First PDF', page: 3, pageCount: 10, progress: 0.22 }))
    await store.open(record('second.pdf'), {})
    fake.emit(snapshot(1, { title: 'Stale PDF', page: 9, pageCount: 10, progress: 0.88 }))
    fake.emit(snapshot(2, { title: 'Second PDF', page: 4, pageCount: 12, progress: 0.27 }))

    expect(fake.opens.map(opening => opening.record.name)).toEqual(['first.pdf', 'second.pdf'])
    expect(store.$state).toMatchObject({
      record: { id: 'second.pdf', name: 'second.pdf', format: 'pdf' },
      status: 'ready',
      title: 'Second PDF',
      page: 4,
      pageCount: 12,
      progress: 0.27,
      generation: 2,
    })
    expect(reader.$state).toMatchObject({
      title: 'Second PDF',
      chapter: '第 4 页 / 共 12 页',
      progress: 0.27,
      isReading: true,
    })
  })

  test('copies outline values and forwards numeric navigation commands', async () => {
    const fake = createFakePort()
    const useStore = createPdfSessionStore(fake.factory)
    const store = useStore(createPinia())
    const emittedOutline: PdfOutlineItem[] = [{
      label: 'Chapter one',
      page: 2,
      children: [{ label: 'Section one', page: 3 }],
    }]

    await store.open(record('outline.pdf'), {})
    fake.emit(snapshot(1, { outline: emittedOutline }))
    emittedOutline[0]!.label = 'Mutated chapter'
    emittedOutline[0]!.children![0]!.page = 8
    await store.goTo(3)
    await store.navigate(-1)
    await store.setZoom(1.25)
    await store.flushProgress()

    expect(store.outline).toEqual([{
      label: 'Chapter one',
      page: 2,
      children: [{ label: 'Section one', page: 3 }],
    }])
    expect(fake.goToPages).toEqual([3])
    expect(fake.calls).toEqual(['open', 'goTo:3', 'navigate:-1', 'setZoom:1.25', 'flushProgress'])
  })

  test('proxies only rendered text layers from the active typed port', () => {
    const fake = createFakePort()
    const layer = { className: 'textLayer' } as HTMLElement
    fake.renderedLayers.set(2, layer)
    const store = createPdfSessionStore(fake.factory)(createPinia())

    expect(store.readRenderedTextLayer(2)).toBe(layer)
    expect(store.readRenderedTextLayer(3)).toBeNull()
    expect(fake.readPages).toEqual([2, 3])
  })

  test('projects a current error as a cloned snapshot and ignores stale errors', async () => {
    const fake = createFakePort()
    const useStore = createPdfSessionStore(fake.factory)
    const pinia = createPinia()
    const store = useStore(pinia)
    const reader = useReaderStore(pinia)
    const emittedOutline: PdfOutlineItem[] = [{ label: 'Chapter one', page: 2 }]
    const emittedError = pdfError('parse')

    await store.open(record('error.pdf'), {})
    fake.emit(snapshot(1, {
      title: 'Error PDF',
      outline: emittedOutline,
      page: 4,
      pageCount: 9,
      zoom: 1.4,
      progress: 0.44,
    }))
    fake.emitError(emittedError, 1)
    emittedOutline[0]!.label = 'Mutated chapter'
    emittedError.detail = 'Mutated detail'
    fake.emitError(pdfError('render'), 0)

    expect(store.$state).toMatchObject({
      status: 'error',
      title: 'Error PDF',
      outline: [{ label: 'Chapter one', page: 2 }],
      page: 4,
      pageCount: 9,
      zoom: 1.4,
      progress: 0.44,
      error: pdfError('parse'),
      generation: 1,
    })
    expect(store.error).not.toBe(emittedError)
    expect(store.outline).not.toBe(emittedOutline)
    expect(reader.$state).toMatchObject({
      title: 'Error PDF',
      chapter: '第 4 页 / 共 9 页',
      progress: 0.44,
      isReading: false,
    })
  })

  test('does not reset an opened replacement session when the original close completes', async () => {
    const first = createFakePort()
    const replacement = createFakePort()
    const useStore = createPdfSessionStore(first.factory)
    const store = useStore(createPinia())
    let releaseClose!: () => void
    first.setClose(() => new Promise<void>(resolve => { releaseClose = resolve }))

    await store.open(record('first.pdf'), {})
    first.emit(snapshot(1, { title: 'First PDF', page: 2, pageCount: 3, progress: 0.5 }))
    const closing = store.close()
    store.attachPort(replacement.factory)
    await store.open(record('replacement.pdf'), {})
    replacement.emit(snapshot(3, { title: 'Replacement PDF', page: 6, pageCount: 8, progress: 0.75 }))
    releaseClose()
    await closing

    expect(store.$state).toMatchObject({
      record: { id: 'replacement.pdf', name: 'replacement.pdf', format: 'pdf' },
      status: 'ready',
      title: 'Replacement PDF',
      page: 6,
      pageCount: 8,
      progress: 0.75,
      generation: 3,
    })
  })

  test('does not reset a newer generation on the same port when close completes', async () => {
    const fake = createFakePort()
    const useStore = createPdfSessionStore(fake.factory)
    const store = useStore(createPinia())
    let releaseClose!: () => void
    fake.setClose(() => new Promise<void>(resolve => { releaseClose = resolve }))

    await store.open(record('first.pdf'), {})
    const closing = store.close()
    await store.open(record('newer.pdf'), {})
    fake.emit(snapshot(3, { title: 'Newer PDF', page: 5, pageCount: 7, progress: 0.6 }))
    releaseClose()
    await closing

    expect(store.$state).toMatchObject({
      record: { id: 'newer.pdf', name: 'newer.pdf', format: 'pdf' },
      status: 'ready',
      title: 'Newer PDF',
      page: 5,
      pageCount: 7,
      progress: 0.6,
      generation: 3,
    })
  })

  test('ignores callbacks from a replaced port and resets only after close completes', async () => {
    const first = createFakePort()
    const second = createFakePort()
    const useStore = createPdfSessionStore()
    const pinia = createPinia()
    const store = useStore(pinia)
    const reader = useReaderStore(pinia)
    let releaseClose!: () => void
    second.setClose(() => new Promise<void>(resolve => { releaseClose = resolve }))

    store.attachPort(first.factory)
    await store.open(record('replacement.pdf'), {})
    first.emit(snapshot(1, { title: 'First PDF', page: 2, pageCount: 3, progress: 0.5 }))
    store.attachPort(second.factory)
    second.emit(snapshot(1, { title: 'Second PDF', page: 3, pageCount: 4, progress: 0.75 }))
    first.emitError(pdfError('render'), 1)
    first.emit(snapshot(1, { title: 'Late first PDF', page: 1, pageCount: 3, progress: 0 }))

    expect(store.$state).toMatchObject({
      record: { id: 'replacement.pdf', name: 'replacement.pdf', format: 'pdf' },
      status: 'ready',
      title: 'Second PDF',
      page: 3,
      pageCount: 4,
      progress: 0.75,
      error: null,
    })
    expect(reader.$state).toMatchObject({
      title: 'Second PDF',
      chapter: '第 3 页 / 共 4 页',
      progress: 0.75,
      isReading: true,
    })

    const closing = store.close()
    expect(store.record?.name).toBe('replacement.pdf')
    expect(store.status).toBe('ready')
    releaseClose()
    await closing

    expect(store.$state).toMatchObject({
      record: null,
      status: 'idle',
      title: '未命名 PDF',
      outline: [],
      page: 1,
      pageCount: 0,
      progress: 0,
    })
  })
})

function createFakePort() {
  let callbacks: PdfSessionCallbacks | null = null
  let close: () => Promise<void> = async () => undefined
  const calls: string[] = []
  const goToPages: number[] = []
  const opens: Array<{ record: BookRecord, settings: Record<string, unknown> }> = []
  const renderedLayers = new Map<number, HTMLElement>()
  const readPages: number[] = []
  const port: PdfSessionPort = {
    async open(record, settings) {
      calls.push('open')
      opens.push({ record, settings })
    },
    async close() {
      calls.push('close')
      await close()
    },
    async goTo(page) {
      calls.push(`goTo:${page}`)
      goToPages.push(page)
    },
    async navigate(direction) { calls.push(`navigate:${direction}`) },
    async setZoom(zoom) { calls.push(`setZoom:${zoom}`) },
    async flushProgress() { calls.push('flushProgress') },
    readRenderedTextLayer(page) {
      readPages.push(page)
      return renderedLayers.get(page) ?? null
    },
    destroy() {},
  }

  const factory: PdfSessionPortFactory = nextCallbacks => {
    callbacks = nextCallbacks
    return port
  }

  return {
    calls,
    factory,
    goToPages,
    opens,
    readPages,
    renderedLayers,
    setClose(nextClose: () => Promise<void>) { close = nextClose },
    emit(next: PdfSessionSnapshot) { callbacks?.onSnapshot(next) },
    emitError(error: PdfSessionError, generation: number) { callbacks?.onError(error, generation) },
    emitRendered(page: number, generation: number) { callbacks?.onPageRendered?.(page, generation) },
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

function snapshot(generation: number, overrides: Partial<PdfSessionSnapshot> = {}): PdfSessionSnapshot {
  return {
    status: 'ready',
    title: 'Untitled PDF',
    outline: [],
    page: 1,
    pageCount: 1,
    zoom: 1,
    progress: 0,
    error: null,
    generation,
    ...overrides,
  }
}

function pdfError(code: PdfSessionError['code']): PdfSessionError {
  return {
    code,
    title: '无法显示 PDF',
    detail: '请重新打开文件后重试。',
    diagnostic: 'adapter diagnostic',
  }
}
