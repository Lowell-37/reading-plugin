// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { createPdfJsSession } from '../entrypoints/reader/pdfjs-session'
import type { PdfSessionError, PdfSessionSnapshot } from '../entrypoints/reader/pdf-session-port'
import type { PdfJsLike, PdfOutlineSource } from '../entrypoints/reader/pdf-session-dependencies'
import type { BookRecord } from '../src/core/types'

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null })

describe('PDF.js session adapter', () => {
  test('projects metadata, serializable outline and page count after opening', async () => {
    const harness = createHarness()
    harness.document.metadata = { info: { Title: 'Engine title' } }
    harness.document.outline = [{ title: 'First', dest: 'chapter-1', items: [{ title: 'Nested', dest: [2] }] }]
    harness.document.destinations.set('chapter-1', [{ index: 0 }])

    await harness.session.open(record('fallback.pdf'), {})

    expect(harness.snapshots.at(-1)).toMatchObject({
      status: 'ready',
      title: 'Engine title',
      page: 1,
      pageCount: 3,
      progress: 0,
      outline: [{ label: 'First', page: 1, children: [{ label: 'Nested', page: 3 }] }],
    })
    expect(harness.loaderRequests).toEqual([{
      data: expect.any(Uint8Array),
      cMapUrl: 'chrome-extension://reader/node_modules/pdfjs-dist/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'chrome-extension://reader/node_modules/pdfjs-dist/standard_fonts/',
      wasmUrl: 'chrome-extension://reader/node_modules/pdfjs-dist/wasm/',
    }])
  })

  test('renders the visible page and text layer lazily through observer callbacks', async () => {
    const harness = createHarness()

    await harness.session.open(record('lazy.pdf'), {})
    await harness.flushFrames()
    harness.observer.trigger(2)
    await harness.flushFrames()

    expect(harness.pages.children).toHaveLength(3)
    expect(harness.document.pages.get(1)?.renderScales).toEqual([1.672])
    expect(harness.document.pages.get(2)?.renderScales).toEqual([1.672])
    expect(harness.textLayerPages).toEqual([1, 2])
    expect(harness.pages.children[1]?.querySelector('.textLayer')?.textContent).toBe('text 2')
  })

  test('renders high-density displays at a capped two-times backing scale', async () => {
    const harness = createHarness({ pixelRatio: 3 })

    await harness.session.open(record('high-density.pdf'), {})
    await harness.flushFrames()

    expect(harness.document.pages.get(1)?.renderScales).toEqual([3.344])
    const canvas = harness.pages.querySelector<HTMLCanvasElement>('.pdf-page canvas')
    expect(canvas?.style.width).toBe('836px')
    expect(canvas?.width).toBe(1672)
  })

  test('exposes only a completed rendered text layer for search consumers', async () => {
    const harness = createHarness()
    await harness.session.open(record('search.pdf'), {})

    expect(harness.session.readRenderedTextLayer(1)).toBeNull()
    await harness.flushFrames()

    const layer = harness.session.readRenderedTextLayer(1)
    expect(layer).toBeInstanceOf(HTMLElement)
    expect(layer?.className).toBe('textLayer')
    expect(layer?.textContent).toBe('text 1')
    expect(harness.session.readRenderedTextLayer(99)).toBeNull()
  })

  test('clamps zoom to 0.6–2.5 in tenths and rebuilds rendered page text layers', async () => {
    const harness = createHarness()
    await harness.session.open(record('zoom.pdf'), {})
    await harness.flushFrames()

    await harness.session.setZoom(2.54)
    await harness.flushFrames()
    await harness.session.setZoom(0.11)
    await harness.flushFrames()

    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', zoom: 0.6 })
    expect(harness.document.pages.get(1)?.renderScales).toEqual([1.672, 4.18, 1.003])
    expect(harness.textLayerPages.filter(page => page === 1)).toEqual([1, 1, 1])
  })

  test('renders the final rendition after multiple zoom changes queue before a frame', async () => {
    const harness = createHarness()
    await harness.session.open(record('rapid-zoom.pdf'), {})
    await harness.flushFrames()

    for (const zoom of [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.4, 2.3, 2.2, 2.1, 2, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1, .9, .8, .7, .6])
      await harness.session.setZoom(zoom)
    await harness.flushFrames()

    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', zoom: .6 })
    expect(harness.pages.querySelector<HTMLElement>('.pdf-page[data-page="1"]')?.dataset.state).toBe('rendered')
    expect(harness.pages.querySelector('.pdf-page[data-page="1"] .textLayer')?.textContent).toBe('text 1')
  })

  test('ignores a rejected cancelled render from a previous zoom rendition', async () => {
    const harness = createHarness({ renderDeferred: true, renderRejectOnCancel: true })
    await harness.session.open(record('zoom-cancel.pdf'), {})
    await harness.flushFrames()
    await waitFor(() => harness.document.pages.get(1)?.renderTasks.length === 1)
    const firstRender = harness.document.pages.get(1)?.renderTasks[0]

    await harness.session.setZoom(1.5)
    await harness.flushFrames()
    await waitFor(() => harness.document.pages.get(1)?.renderTasks.length === 2)
    const secondRender = harness.document.pages.get(1)?.renderTasks[1]
    await settle()

    expect(firstRender?.cancelCalls).toBe(1)
    expect(harness.errors).toEqual([])
    expect(harness.pages.querySelector<HTMLElement>('.pdf-page[data-page="1"]')?.dataset.state).toBe('rendering')

    await harness.session.setZoom(1.8)
    expect(secondRender?.cancelCalls).toBe(1)
  })

  test('does not create a stale render task when zoom changes during text-content loading', async () => {
    const harness = createHarness({ textContentDeferred: true })
    await harness.session.open(record('zoom-text-content.pdf'), {})
    await harness.flushFrames()
    await waitFor(() => harness.document.pages.get(1)?.textContentRequests === 1)

    await harness.session.setZoom(1.5)
    harness.document.resolveTextContent()
    await settle()

    expect(harness.document.pages.get(1)?.renderScales).toEqual([])
    expect(harness.document.pages.get(1)?.renderTasks).toEqual([])
    expect(harness.errors).toEqual([])
    expect(harness.pages.querySelector<HTMLElement>('.pdf-page[data-page="1"]')?.dataset.state).toBe('idle')
  })

  test('navigates by page, schedules PDF progress and flushes it', async () => {
    const harness = createHarness()
    await harness.session.open(record('navigation.pdf'), {})

    await harness.session.goTo(99)
    await harness.session.navigate(-1)
    await harness.session.navigate(1)
    await harness.session.flushProgress()

    expect(harness.snapshots.at(-1)).toMatchObject({ page: 3, pageCount: 3, progress: 1 })
    expect(harness.scheduled).toEqual([
      { bookId: 'navigation.pdf', progress: { kind: 'pdf', page: 1, fraction: 0 } },
      { bookId: 'navigation.pdf', progress: { kind: 'pdf', page: 3, fraction: 1 } },
      { bookId: 'navigation.pdf', progress: { kind: 'pdf', page: 2, fraction: 0.5 } },
      { bookId: 'navigation.pdf', progress: { kind: 'pdf', page: 3, fraction: 1 } },
    ])
    expect(harness.flushCalls).toBe(1)
  })

  test('scrolling chooses the page at the reading line without scrolling back or duplicate progress', async () => {
    const harness = createHarness()
    await harness.session.open(record('scroll.pdf'), {})
    harness.enableLayout()
    await harness.flushFrames()
    const scrollCalls = harness.scrollCalls

    // Page 1 still intersects, but the reading line (100px below the top) is on page 2.
    harness.scroll(950)
    harness.scroll(970)
    await harness.flushFrames()

    expect(harness.snapshots.at(-1)).toMatchObject({ page: 2, progress: 0.5 })
    expect(harness.scheduled.at(-1)).toEqual({ bookId: 'scroll.pdf', progress: { kind: 'pdf', page: 2, fraction: 0.5 } })
    expect(harness.scrollCalls).toBe(scrollCalls)
    const scheduledCount = harness.scheduled.length
    harness.scroll(1000)
    await harness.flushFrames()
    expect(harness.scheduled).toHaveLength(scheduledCount)
  })

  test('relative navigation settles a scroll before its queued frame and ignores goTo feedback', async () => {
    const harness = createHarness()
    await harness.session.open(record('scroll-navigate.pdf'), {})
    harness.enableLayout()
    harness.scroll(1020)
    await harness.session.navigate(1)
    await harness.flushFrames()
    expect(harness.snapshots.at(-1)).toMatchObject({ page: 3, progress: 1 })
    expect(harness.scheduled.map(value => value.progress)).toEqual([
      { kind: 'pdf', page: 1, fraction: 0 },
      { kind: 'pdf', page: 2, fraction: 0.5 },
      { kind: 'pdf', page: 3, fraction: 1 },
    ])
  })

  test.each(['flushProgress', 'close', 'open'] as const)('%s settles unframed scroll progress before flushing', async operation => {
    const harness = createHarness()
    await harness.session.open(record('scroll-flush.pdf'), {})
    harness.enableLayout()
    harness.scroll(1020)
    if (operation === 'open') await harness.session.open(record('replacement.pdf'), {})
    else await harness.session[operation]()
    expect(harness.flushed.at(-1)).toEqual({ bookId: 'scroll-flush.pdf', progress: { kind: 'pdf', page: 2, fraction: 0.5 } })
  })

  test.each(['close', 'destroy'] as const)('%s removes the scroll listener and frames; stale callbacks cannot update a replacement', async operation => {
    const harness = createHarness()
    await harness.session.open(record('old-scroll.pdf'), {})
    harness.enableLayout()
    await harness.flushFrames()
    harness.scroll(1020)
    const oldFrames = harness.pendingFrames()
    expect(oldFrames.length).toBeGreaterThan(0)
    await cancelSession(harness, operation)
    harness.scroll(2040)
    expect(harness.pendingFrames()).toHaveLength(0)

    await harness.session.open(record('new-scroll.pdf'), {})
    harness.enableLayout()
    await harness.flushFrames()
    const snapshots = harness.snapshots.length
    const scheduled = harness.scheduled.length
    harness.viewport.scrollTop = 1020
    oldFrames.forEach(callback => callback(performance.now()))
    expect(harness.snapshots).toHaveLength(snapshots)
    expect(harness.scheduled).toHaveLength(scheduled)
    expect(harness.snapshots.at(-1)).toMatchObject({ title: 'new-scroll', page: 1 })
  })

  test('does not flush on the first open but flushes when replacing or closing an active session', async () => {
    const harness = createHarness()

    await harness.session.open(record('first.pdf'), {})
    expect(harness.flushCalls).toBe(0)

    await harness.session.open(record('replacement.pdf'), {})
    expect(harness.flushCalls).toBe(1)

    await harness.session.close()
    expect(harness.flushCalls).toBe(2)
  })

  test('restores a stored PDF page before publishing ready', async () => {
    const harness = createHarness()

    await harness.session.open(record('restored.pdf', { kind: 'pdf', page: 2, fraction: 0.5 }), {})

    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', page: 2, progress: 0.5 })
    expect(harness.scheduled).toEqual([{ bookId: 'restored.pdf', progress: { kind: 'pdf', page: 2, fraction: 0.5 } }])
  })

  test('does not publish ready after a stored-page restore failure', async () => {
    const harness = createHarness({ scrollError: new Error('restore secret') })

    await harness.session.open(record('restore-failure.pdf', { kind: 'pdf', page: 2, fraction: 0.5 }), {})

    expect(harness.errors).toMatchObject([{ code: 'restore' }])
    expect(harness.snapshots.some(snapshot => snapshot.status === 'ready')).toBe(false)
    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'loading', page: 1 })
  })

  test('maps a normal navigation scroll failure without making the session ready again', async () => {
    const harness = createHarness()
    await harness.session.open(record('navigation-failure.pdf'), {})
    harness.setScrollError(new Error('navigation secret'))

    await harness.session.goTo(2)

    expect(harness.errors.at(-1)).toMatchObject({ code: 'render' })
    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', page: 1 })
  })

  test.each([
    ['password', () => ({ name: 'PasswordException', message: 'private token' })],
    ['parse', () => new Error('private token')],
  ] as const)('maps %s loading failures to safe errors', async (code, cause) => {
    const harness = createHarness({ loadingError: cause() })

    await harness.session.open(record('broken.pdf'), {})

    expect(harness.errors.at(-1)).toMatchObject({ code })
    expect(harness.errors.at(-1)?.title).not.toContain('private token')
    expect(harness.errors.at(-1)?.detail).not.toContain('private token')
  })

  test('maps render and restore failures without leaking engine errors', async () => {
    const renderHarness = createHarness({ renderError: new Error('render secret') })
    await renderHarness.session.open(record('render.pdf'), {})
    await renderHarness.flushFrames()

    const restoreHarness = createHarness({ scrollError: new Error('restore secret') })
    await restoreHarness.session.open(record('restore.pdf', { kind: 'pdf', page: 2, fraction: 0.5 }), {})

    expect(renderHarness.errors.at(-1)).toMatchObject({ code: 'render' })
    expect(restoreHarness.errors.at(-1)).toMatchObject({ code: 'restore' })
    expect(renderHarness.errors.at(-1)?.detail).not.toContain('render secret')
    expect(restoreHarness.errors.at(-1)?.detail).not.toContain('restore secret')
  })

  test('cancels resources and ignores stale loading callbacks from an overlapping open', async () => {
    const harness = createHarness({ loadingDeferred: true })
    const oldOpen = harness.session.open(record('old.pdf'), {})
    await waitFor(() => harness.loaderRequests.length === 1)
    const newDocument = new FakePdfDocument(2)
    harness.queueDocument(newDocument)

    await harness.session.open(record('new.pdf'), {})
    harness.loading.resolve(harness.document)
    await oldOpen

    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', title: 'new', pageCount: 2 })
    expect(harness.loading.destroyCalls).toBe(1)
    expect(harness.document.destroyCalls).toBe(1)
    expect(harness.document.pages.get(1)?.renderScales).toEqual([])
  })

  test('cancels stale rendering and ignores a disconnected observer after replacement', async () => {
    const harness = createHarness({ renderDeferred: true })
    await harness.session.open(record('old.pdf'), {})
    await harness.flushFrames()
    await waitFor(() => harness.document.pages.get(1)?.renderTasks.length === 1)
    const oldObserver = harness.observer.at(0)
    const newDocument = new FakePdfDocument(3)
    harness.queueDocument(newDocument)

    await harness.session.open(record('new.pdf'), {})
    oldObserver.trigger(3)
    harness.document.resolveRenders()
    await settle()

    expect(harness.document.pages.get(1)?.renderTasks[0]?.cancelCalls).toBe(1)
    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', title: 'new', pageCount: 3 })
    expect(newDocument.pages.get(3)?.renderScales).toEqual([])
    expect(harness.pages.querySelector<HTMLElement>('.pdf-page[data-page="1"]')?.dataset.state).not.toBe('rendered')
  })

  test.each(['close', 'destroy'] as const)('%s cancels a deferred load before its stale document can mutate the session', async operation => {
    const harness = createHarness({ loadingDeferred: true })
    const opening = harness.session.open(record(`${operation}-load.pdf`), {})
    await waitFor(() => harness.loaderRequests.length === 1)
    const snapshotCount = harness.snapshots.length

    await cancelSession(harness, operation)
    harness.loading.resolve(harness.document)
    await opening
    await waitFor(() => harness.document.destroyCalls === 1)

    expect(harness.loading.destroyCalls).toBe(1)
    expect(harness.snapshots).toHaveLength(snapshotCount)
    expect(harness.errors).toEqual([])
    expect(harness.pages.children).toHaveLength(0)
  })

  test.each(['close', 'destroy'] as const)('%s cancels a rejecting render without stale errors, snapshots, or DOM', async operation => {
    const harness = createHarness({ renderDeferred: true, renderRejectOnCancel: true })
    await harness.session.open(record(`${operation}-render.pdf`), {})
    await harness.flushFrames()
    await waitFor(() => harness.document.pages.get(1)?.renderTasks.length === 1)
    const render = harness.document.pages.get(1)?.renderTasks[0]
    const snapshotCount = harness.snapshots.length

    await cancelSession(harness, operation)
    await waitFor(() => harness.document.destroyCalls === 1)
    await settle()

    expect(render?.cancelCalls).toBe(1)
    expect(harness.snapshots).toHaveLength(snapshotCount)
    expect(harness.errors).toEqual([])
    expect(harness.pages.children).toHaveLength(0)
  })

  test.each(['close', 'destroy'] as const)('%s prevents a stale render task after text-content loading', async operation => {
    const harness = createHarness({ textContentDeferred: true })
    await harness.session.open(record(`${operation}-text-content.pdf`), {})
    await harness.flushFrames()
    await waitFor(() => harness.document.pages.get(1)?.textContentRequests === 1)
    const snapshotCount = harness.snapshots.length

    await cancelSession(harness, operation)
    harness.document.resolveTextContent()
    await waitFor(() => harness.document.destroyCalls === 1)
    await settle()

    expect(harness.document.pages.get(1)?.renderScales).toEqual([])
    expect(harness.document.pages.get(1)?.renderTasks).toEqual([])
    expect(harness.snapshots).toHaveLength(snapshotCount)
    expect(harness.errors).toEqual([])
    expect(harness.pages.children).toHaveLength(0)
  })
})

async function cancelSession(harness: ReturnType<typeof createHarness>, operation: 'close' | 'destroy') {
  if (operation === 'close') await harness.session.close()
  else harness.session.destroy()
}

function createHarness(options: {
  pixelRatio?: number
  loadingError?: unknown
  loadingDeferred?: boolean
  renderDeferred?: boolean
  renderRejectOnCancel?: boolean
  textContentDeferred?: boolean
  renderError?: Error
  scrollError?: Error
} = {}) {
  const snapshots: PdfSessionSnapshot[] = []
  const errors: PdfSessionError[] = []
  const scheduled: Array<{ bookId: string, progress: unknown }> = []
  const flushed: Array<{ bookId: string, progress: unknown } | undefined> = []
  const pages = document.createElement('div')
  const viewport = document.createElement('div')
  Object.defineProperty(viewport, 'clientWidth', { value: 900 })
  let scrollError = options.scrollError
  let scrollCalls = 0
  Object.defineProperty(viewport, 'scrollTo', {
    value: (position: ScrollToOptions) => {
      if (scrollError) throw scrollError
      scrollCalls += 1
      viewport.scrollTop = position.top ?? 0
      viewport.dispatchEvent(new Event('scroll'))
    },
  })
  const observer = new FakeObserverFactory()
  const documentToLoad = new FakePdfDocument(3, options)
  const queuedDocuments: FakePdfDocument[] = [documentToLoad]
  const loaderRequests: unknown[] = []
  const textLayerPages: number[] = []
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  let generation = 0
  let flushCalls = 0

  const engine: PdfJsLike = {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument(request) {
      loaderRequests.push(request)
      const next = queuedDocuments.shift() ?? documentToLoad
      return next.loading
    },
    TextLayer: class {
      constructor(private readonly input: { container: HTMLElement, textContentSource: unknown, viewport: unknown }) {}
      async render() {
        const source = this.input.textContentSource as { page: number }
        textLayerPages.push(source.page)
        this.input.container.textContent = `text ${source.page}`
      }
    },
  }

  const session = createPdfJsSession({
    baseUrl: 'chrome-extension://reader/node_modules/pdfjs-dist/',
    host: { pages, viewport },
    loadPdfJs: async () => engine,
    nextGeneration: () => ++generation,
    createObserver: callback => observer.create(callback),
    requestFrame: callback => {
      const id = nextFrame++
      frames.set(id, callback)
      return id
    },
    cancelFrame: id => { frames.delete(id) },
    pixelRatio: () => options.pixelRatio ?? 1,
    createProgressService: () => ({
      schedule(bookId: string, progress: unknown) {
        scheduled.push({ bookId, progress })
        return true
      },
      async flush() { flushCalls += 1; flushed.push(scheduled.at(-1)); return true },
      cancel() {},
    }),
    onSnapshot: snapshot => { snapshots.push(snapshot) },
    onError: error => { errors.push(error) },
  })

  return {
    session,
    snapshots,
    errors,
    scheduled,
    flushed,
    pages,
    viewport,
    observer,
    document: documentToLoad,
    loading: documentToLoad.loading,
    loaderRequests,
    textLayerPages,
    get flushCalls() { return flushCalls },
    get scrollCalls() { return scrollCalls },
    pendingFrames() { return [...frames.values()] },
    scroll(top: number) { viewport.scrollTop = top; viewport.dispatchEvent(new Event('scroll')) },
    enableLayout() {
      Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
      viewport.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 }) as DOMRect
      for (const [index, wrapper] of [...pages.children].entries()) {
        Object.defineProperty(wrapper, 'offsetTop', { configurable: true, value: index * 1020 })
        wrapper.getBoundingClientRect = () => ({ top: index * 1020 - viewport.scrollTop, bottom: index * 1020 + 1000 - viewport.scrollTop, height: 1000 }) as DOMRect
      }
    },
    setScrollError(next: Error | undefined) { scrollError = next },
    queueDocument(next: FakePdfDocument) { queuedDocuments.push(next) },
    async flushFrames() {
      while (frames.size) {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach(callback => callback(performance.now()))
        await settle()
      }
    },
  }
}

class FakeObserverFactory {
  private readonly observers: FakeObserver[] = []

  create(callback: IntersectionObserverCallback) {
    const observer = new FakeObserver(callback)
    this.observers.push(observer)
    return observer
  }

  at(index: number) {
    const observer = this.observers[index]
    if (!observer) throw new Error(`Missing observer ${index}`)
    return observer
  }

  trigger(page: number) {
    this.at(this.observers.length - 1).trigger(page)
  }
}

class FakeObserver {
  private readonly targets = new Map<number, Element>()

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) { this.targets.set(Number((target as HTMLElement).dataset.page), target) }
  disconnect() {}

  trigger(page: number) {
    const target = this.targets.get(page)
    if (target) this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver)
  }
}

class FakeLoadingTask {
  destroyCalls = 0
  readonly promise: Promise<FakePdfDocument>
  private resolvePromise!: (document: FakePdfDocument) => void

  constructor(document: FakePdfDocument, error: unknown, deferred: boolean) {
    this.promise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      if (error) reject(error)
      else if (!deferred) resolve(document)
    })
    void this.promise.catch(() => {})
  }

  resolve(document: FakePdfDocument) { this.resolvePromise(document) }
  destroy() { this.destroyCalls += 1 }
}

class FakePdfDocument {
  destroyCalls = 0
  readonly destinations = new Map<string, unknown>()
  readonly loading: FakeLoadingTask
  metadata: { info?: { Title?: unknown } } | null = { info: {} }
  outline: PdfOutlineSource[] | null = []
  readonly pages = new Map<number, FakePage>()

  constructor(readonly numPages: number, options: { loadingError?: unknown, loadingDeferred?: boolean, renderDeferred?: boolean, renderRejectOnCancel?: boolean, textContentDeferred?: boolean, renderError?: Error } = {}) {
    this.loading = new FakeLoadingTask(this, options.loadingError, Boolean(options.loadingDeferred))
    for (let page = 1; page <= numPages; page += 1) this.pages.set(page, new FakePage(page, options))
  }

  async getMetadata(): Promise<{ info?: { Title?: unknown } } | null> { return this.metadata }
  async getOutline(): Promise<PdfOutlineSource[] | null> { return this.outline }
  async getDestination(name: string) { return this.destinations.get(name) }
  async getPageIndex(reference: { index: number }) { return reference.index }
  async getPage(page: number) {
    const result = this.pages.get(page)
    if (!result) throw new Error(`no page ${page}`)
    return result
  }
  resolveRenders() {
    for (const page of this.pages.values()) page.resolveRenders()
  }
  resolveTextContent() {
    for (const page of this.pages.values()) page.resolveTextContent()
  }
  destroy() { this.destroyCalls += 1 }
}

class FakePage {
  renderScales: number[] = []
  readonly renderTasks: FakeRenderTask[] = []
  textContentRequests = 0
  private readonly textContentResolvers: Array<(content: { page: number }) => void> = []

  constructor(readonly number: number, private readonly options: { renderDeferred?: boolean, renderRejectOnCancel?: boolean, textContentDeferred?: boolean, renderError?: Error }) {}

  getViewport({ scale }: { scale: number }) { return { width: 500 * scale, height: 800 * scale, scale } }
  getTextContent() {
    this.textContentRequests += 1
    if (!this.options.textContentDeferred) return Promise.resolve({ page: this.number })
    return new Promise<{ page: number }>(resolve => this.textContentResolvers.push(resolve))
  }
  render({ viewport }: { canvasContext: CanvasRenderingContext2D | null, viewport: unknown }) {
    this.renderScales.push(Number((viewport as { scale: number }).scale.toFixed(3)))
    const task = new FakeRenderTask(this.options.renderError, Boolean(this.options.renderDeferred), Boolean(this.options.renderRejectOnCancel))
    this.renderTasks.push(task)
    return task
  }

  resolveRenders() { this.renderTasks.forEach(task => task.resolve()) }
  resolveTextContent() { this.textContentResolvers.splice(0).forEach(resolve => resolve({ page: this.number })) }
}

class FakeRenderTask {
  cancelCalls = 0
  readonly promise: Promise<void>
  private resolvePromise!: () => void
  private rejectPromise!: (error: Error) => void

  constructor(error: Error | undefined, deferred: boolean, private readonly rejectOnCancel: boolean) {
    this.promise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
      if (error) reject(error)
      else if (!deferred) resolve()
    })
  }

  resolve() { this.resolvePromise() }
  cancel() {
    this.cancelCalls += 1
    if (this.rejectOnCancel) this.rejectPromise(new Error('cancelled render'))
  }
}

function record(name: string, progress?: BookRecord['progress']): BookRecord {
  return {
    id: name,
    name,
    type: 'application/pdf',
    size: 4,
    lastModified: 1,
    format: 'pdf',
    blob: new Blob(['pdf']),
    openedAt: 1,
    progress,
  }
}

function tick() { return Promise.resolve() }

async function settle() {
  for (let count = 0; count < 5; count += 1) await tick()
}

async function waitFor(predicate: () => boolean) {
  for (let count = 0; count < 10; count += 1) {
    if (predicate()) return
    await settle()
  }
  throw new Error('Timed out waiting for test condition')
}
