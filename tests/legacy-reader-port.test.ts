// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../entrypoints/reader/App.vue'
import { createFoliateEbookSession } from '../entrypoints/reader/foliate-ebook-session'
import { useEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import { useLibraryStore } from '../entrypoints/reader/stores/library'
import { useSettingsStore } from '../entrypoints/reader/stores/settings'
import type { LegacyReaderState } from '../entrypoints/reader/legacy-reader-port'
import type { BookRecord } from '../src/core/types'

vi.mock('../node_modules/foliate-js/view.js', () => ({}))
vi.mock('../node_modules/foliate-js/overlayer.js', () => ({ Overlayer: { highlight() {} } }))
vi.mock('../src/book-repository.js', () => ({
  bookRepository: {
    delete: async () => undefined,
    list: async () => [],
    restore: async () => undefined,
    save: async () => undefined,
    update: vi.fn(async () => undefined),
  },
}))
vi.mock('../node_modules/pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    constructor(private options: { container: HTMLElement }) {}
    async render() {
      this.options.container.innerHTML = '<span>Session searchable text.</span>'
    }
  },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      destroy: vi.fn(async () => undefined),
      getMetadata: async () => null,
      getOutline: async () => [],
      getPage: async () => ({
        getTextContent: async () => ({ items: [] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      }),
      numPages: 3,
    }),
    destroy: async () => undefined,
  })),
}))

describe('legacy reader port lifecycle', () => {
  let wrapper: VueWrapper
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.documentElement.dataset.legacyController = 'loading'
    pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [pinia] },
    })
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: () => undefined,
    })
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.replaceChildren()
    delete document.documentElement.dataset.legacyController
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('WXT rejects direct legacy PDF opens without loading the PDF engine', async () => {
    const states: Array<Record<string, unknown>> = []
    // @ts-expect-error JavaScript compatibility controller has no declaration file.
    const { createLegacyReaderPort } = await import('../src/reader.js')
    const port = createLegacyReaderPort({
      onState: (state: Record<string, unknown>) => states.push(state),
      onPanelRequest() {},
      onLibraryChanged() {},
    })

    await expect(port.openRecord(record('old.pdf', 'pdf'))).rejects.toThrow('WXT legacy reader port cannot open PDF records')
    // @ts-expect-error PDF.js ESM build has no declaration.
    const engine = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
    expect(engine.getDocument).not.toHaveBeenCalled()
    port.destroy()
  })

  test('destroy emits a final non-reading state before disconnecting callbacks', async () => {
    const states: Array<Record<string, unknown>> = []
    // @ts-expect-error JavaScript compatibility controller has no declaration file.
    const { createLegacyReaderPort } = await import('../src/reader.js')
    const port = createLegacyReaderPort({
      onState: (state: Record<string, unknown>) => states.push(state),
      onPanelRequest() {},
      onLibraryChanged() {},
    })

    port.destroy()

    expect(states.at(-1)).toEqual({
      title: '未命名书籍',
      chapter: '开始',
      progress: 0,
      isReading: false,
    })
  })

  test('WXT port mode leaves migrated panel buttons to Vue without duplicate requests', async () => {
    const panelRequests: unknown[] = []
    // @ts-expect-error JavaScript compatibility controller has no declaration file.
    const { createLegacyReaderPort } = await import('../src/reader.js')
    const port = createLegacyReaderPort({
      onState() {},
      onPanelRequest: (panel: unknown) => panelRequests.push(panel),
      onLibraryChanged() {},
    })

    document.querySelector<HTMLElement>('#settings-button')?.click()

    expect(panelRequests).toEqual([])
    port.destroy()
  })

  test.each(['epub', 'mobi', 'azw3'] as const)('WXT routes %s through its mounted ebook session without legacy ebook ownership', async format => {
    // @ts-expect-error JavaScript compatibility controller has no declaration file.
    const { createLegacyReaderPort } = await import('../src/reader.js')
    const states: Array<Partial<LegacyReaderState>> = []
    const prevBinding = vi.spyOn(document.querySelector<HTMLElement>('#prev-button')!, 'addEventListener')
    const nextBinding = vi.spyOn(document.querySelector<HTMLElement>('#next-button')!, 'addEventListener')
    const progressBinding = vi.spyOn(document.querySelector<HTMLInputElement>('#progress-slider')!, 'addEventListener')
    const keyboardBinding = vi.spyOn(window, 'addEventListener')
    const port = createLegacyReaderPort({
      onState: (state: Partial<LegacyReaderState>) => states.push(state),
      onPanelRequest() {},
      onLibraryChanged() {},
    })
    const legacyOpen = vi.spyOn(port, 'openRecord')
    expect(prevBinding).not.toHaveBeenCalled()
    expect(nextBinding).not.toHaveBeenCalled()
    expect(progressBinding).not.toHaveBeenCalled()
    expect(keyboardBinding).not.toHaveBeenCalled()
    const ebook = useEbookSessionStore(pinia)
    const library = useLibraryStore(pinia)
    Object.assign(useSettingsStore(pinia).settings, { flow: 'paginated' })
    const progressWrites: Array<{ id: string, fraction: number }> = []
    const views: MountedEbookView[] = []
    let generation = 0
    ebook.attachPort(callbacks => createFoliateEbookSession({
      ...callbacks,
      host: document.querySelector('#ebook-host')!,
      createView: () => {
        const view = createMountedEbookView()
        views.push(view)
        return view
      },
      createScroller: () => { throw new Error('scrolled mode is not used in this test') },
      createProgressService: () => ({
        schedule(id, progress) {
          progressWrites.push({ id, fraction: progress.fraction })
          return true
        },
        flush: async () => false,
        cancel() {},
      }),
      nextGeneration: () => ++generation,
    }))
    library.attachLegacyPort(port)
    library.attachEbookPort(ebook)

    await library.openRecord(record(`session.${format}`, format))

    expect(ebook.error).toBeNull()
    expect(ebook.status).toBe('ready')
    const view = views[0]!
    expect(view).toBeTruthy()
    expect(view.parentElement).toBe(document.querySelector('#ebook-host'))
    expect(legacyOpen).not.toHaveBeenCalled()

    const stateCount = states.length
    view.relocate({ cfi: '/6/2', fraction: 0.75, tocItem: { label: 'Session chapter' } })
    expect(ebook.progress).toBe(0.75)
    expect(progressWrites).toEqual([{ id: `session.${format}`, fraction: 0.75 }])
    document.querySelector<HTMLElement>('#prev-button')?.click()
    document.querySelector<HTMLElement>('#next-button')?.click()
    await Promise.resolve()
    expect(view.goLeftCalls).toBe(1)
    expect(view.goRightCalls).toBe(1)
    const progress = document.querySelector<HTMLInputElement>('#progress-slider')!
    progress.value = '0.75'
    progress.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.classList.add('is-reading')
    const keyboard = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(keyboard)

    expect(states).toHaveLength(stateCount)
    expect(keyboard.defaultPrevented).toBe(true)
    expect(view.goRightCalls).toBe(2)
    expect(view.goToFractionCalls).toBe(0)
    await expect(port.openRecord(record(`legacy.${format}`, format)))
      .rejects.toThrow('WXT legacy reader port cannot open ebook records')
    expect(view.isConnected).toBe(true)
    expect(document.querySelector('#ebook-host')?.children).toHaveLength(1)

    port.destroy()
  })

  test('applying settings through the WXT port synchronizes the legacy header body class', async () => {
    // @ts-expect-error JavaScript compatibility controller has no declaration file.
    const { createLegacyReaderPort } = await import('../src/reader.js')
    const port = createLegacyReaderPort({
      onState() {},
      onPanelRequest() {},
      onLibraryChanged() {},
    })

    await port.applySettings({ headerCollapsed: true })
    expect(document.body.classList.contains('header-collapsed')).toBe(true)

    await port.applySettings({ headerCollapsed: false })
    expect(document.body.classList.contains('header-collapsed')).toBe(false)
    port.destroy()
  })
})

function record(name: string, format: BookRecord['format']): BookRecord {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'application/octet-stream' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  })
  return {
    id: name,
    name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
    format,
    blob: file,
    openedAt: 1,
  }
}

class MountedEbookView extends HTMLElement {
  book = { metadata: { title: 'Mounted session' }, toc: [], sections: [] }
  renderer = { setAttribute() {}, setStyles() {} }
  lastLocation = { fraction: 0 }
  goLeftCalls = 0
  goRightCalls = 0
  goToFractionCalls = 0

  async open() {}
  async goTo() {}
  async goToFraction() { this.goToFractionCalls += 1 }
  async goToTextStart() {}
  async goLeft() { this.goLeftCalls += 1 }
  async goRight() { this.goRightCalls += 1 }
  async close() {}

  relocate(detail: { cfi: string, fraction: number, tocItem: { label: string } }) {
    this.lastLocation = detail
    this.dispatchEvent(new CustomEvent('relocate', { detail }))
  }
}

function createMountedEbookView() {
  if (!customElements.get('mounted-ebook-view')) customElements.define('mounted-ebook-view', MountedEbookView)
  return document.createElement('mounted-ebook-view') as MountedEbookView
}
