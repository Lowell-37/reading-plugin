// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../entrypoints/reader/App.vue'
import type { BookRecord } from '../src/core/types'

vi.mock('../node_modules/foliate-js/view.js', () => ({}))
vi.mock('../node_modules/foliate-js/overlayer.js', () => ({ Overlayer: { highlight() {} } }))
vi.mock('../src/book-repository.js', () => ({
  bookRepository: {
    delete: async () => undefined,
    list: async () => [],
    restore: async () => undefined,
    save: async () => undefined,
    update: async () => undefined,
  },
}))
vi.mock('../node_modules/pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  TextLayer: class {
    async render() {}
  },
  getDocument: () => ({
    promise: Promise.resolve({
      destroy: async () => undefined,
      getMetadata: async () => null,
      getOutline: async () => [],
      getPage: async () => ({
        getTextContent: async () => ({ items: [] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: Promise.resolve() }),
      }),
      numPages: 3,
    }),
    destroy: async () => undefined,
  }),
}))

describe('legacy reader port lifecycle', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.resetModules()
    document.documentElement.dataset.legacyController = 'loading'
    wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [createPinia()] },
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

  test('opening a new record resets chapter and progress from the previous session', async () => {
    const states: Array<Record<string, unknown>> = []
    // @ts-expect-error JavaScript compatibility controller has no declaration file.
    const { createLegacyReaderPort } = await import('../src/reader.js')
    const port = createLegacyReaderPort({
      onState: (state: Record<string, unknown>) => states.push(state),
      onPanelRequest() {},
      onLibraryChanged() {},
    })

    await port.openRecord(record('old.pdf', 'pdf'))
    const viewport = document.querySelector('#pdf-viewport') as HTMLElement
    const pages = [...document.querySelectorAll<HTMLElement>('.pdf-page')]
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
    pages.forEach((page, index) => vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(rect(index === 1 ? 42 : 300, 0)))
    viewport.onscroll?.(new Event('scroll'))
    expect(states.at(-1)).toMatchObject({ chapter: '第 2 页 / 共 3 页', progress: 0.5 })

    states.length = 0
    await port.openRecord(record('next.txt', 'pdf'))

    expect(states.at(-1)).toEqual({
      title: 'next.txt',
      chapter: '开始',
      progress: 0,
      isReading: true,
    })
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
    await port.openRecord(record('session.txt', 'pdf'))
    expect(states.at(-1)).toMatchObject({ isReading: true })

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

  test('WXT legacy port rejects ebook records before it initializes a legacy ebook view', async () => {
    // @ts-expect-error JavaScript compatibility controller has no declaration file.
    const { createLegacyReaderPort } = await import('../src/reader.js')
    const port = createLegacyReaderPort({
      onState() {},
      onPanelRequest() {},
      onLibraryChanged() {},
    })

    await expect(port.openRecord(record('session.epub', 'epub')))
      .rejects.toThrow('WXT legacy reader port cannot open ebook records')
    expect(document.querySelector('#ebook-host')?.children).toHaveLength(0)

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

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}
