// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from '../entrypoints/reader/App.vue'
import { connectLegacyReaderState } from '../entrypoints/reader/legacy-bridge'
import { useReaderStore } from '../entrypoints/reader/stores/reader'
import { useSettingsStore } from '../entrypoints/reader/stores/settings'
import { useMigrationStore } from '../entrypoints/reader/stores/migration'
import { useLibraryStore } from '../entrypoints/reader/stores/library'
import { useEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import type { EbookSessionCallbacks, EbookSessionError, EbookSessionSnapshot } from '../entrypoints/reader/ebook-session-port'
import type { BookRecord } from '../src/core/types'

afterEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
  document.body.className = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Vue reader shell', () => {
  test('renders all legacy reader integration points through components', () => {
    const pinia = createPinia()
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    for (const id of [
      'app-header', 'welcome-view', 'book-grid', 'reader-view', 'toc',
      'settings-panel', 'tools-panel', 'selection-ai-menu', 'file-input',
    ]) {
      expect(wrapper.find(`#${id}`).exists()).toBe(true)
    }
    wrapper.unmount()
  })

  test('Pinia stores runtime UI state without owning persisted books', () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    expect(store.$state).toEqual({
      title: '未命名书籍',
      chapter: '开始',
      progress: 0,
      isReading: false,
      activePanel: null,
    })
    expect('books' in store.$state).toBe(false)
    expect('annotations' in store.$state).toBe(false)
  })

  test('projects structured legacy reader state callbacks into Pinia', () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    const bridge = connectLegacyReaderState(pinia)

    bridge.callbacks.onState({ title: '海边的卡夫卡', isReading: true })
    bridge.callbacks.onState({ chapter: '第一章', progress: 0.375 })
    bridge.callbacks.onPanelRequest('toc')

    expect(store.$state).toEqual({
      title: '海边的卡夫卡',
      chapter: '第一章',
      progress: 0.375,
      isReading: true,
      activePanel: 'toc',
    })
  })

  test('projects ebook snapshots into the legacy reader shell without changing its active panel', () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    store.requestPanel('toc')

    store.applyEbookSessionSnapshot(ebookSnapshot({
      title: 'WXT ebook',
      chapter: 'Chapter two',
      progress: 0.5,
      status: 'ready',
    }))

    expect(store.$state).toEqual({
      title: 'WXT ebook',
      chapter: 'Chapter two',
      progress: 0.5,
      isReading: true,
      activePanel: 'toc',
    })
  })

  test('routes ebook TOC, navigation, close, and flow controls through the ebook session store', async () => {
    const pinia = createPinia()
    const reader = useReaderStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    const library = useLibraryStore(pinia)
    const load = vi.spyOn(library, 'load').mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.flow = 'paginated'
    ebook.toc = [{ label: 'First chapter', href: '/6/2' }]
    reader.applyEbookSessionSnapshot(ebookSnapshot({ status: 'ready', toc: ebook.toc }))
    const goTo = vi.spyOn(ebook, 'goTo').mockResolvedValue(undefined)
    const navigate = vi.spyOn(ebook, 'navigate').mockResolvedValue(undefined)
    const close = vi.spyOn(ebook, 'close').mockResolvedValue(undefined)
    const applySettings = vi.spyOn(ebook, 'applySettings').mockResolvedValue(undefined)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('#reader-view').classes()).toContain('ebook-session-active')
    expect(wrapper.find('#reader-view').attributes('hidden')).toBeUndefined()
    expect(wrapper.find('#welcome-view').attributes('hidden')).toBeDefined()
    expect(document.body.classList).toContain('is-reading')
    expect(wrapper.find('#ebook-host').attributes('hidden')).toBeUndefined()
    expect(wrapper.find('#pdf-viewport').attributes('hidden')).toBeDefined()
    expect(wrapper.findAll('#toc button')).toHaveLength(1)

    await wrapper.find('#sidebar-button').trigger('click')
    await wrapper.find('#toc button').trigger('click')
    await wrapper.find('#prev-button').trigger('click')
    await wrapper.find('#next-button').trigger('click')
    await wrapper.find('[data-flow="scrolled"]').trigger('click')
    await wrapper.find('#home-button').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(goTo).toHaveBeenCalledTimes(1)
    expect(goTo).toHaveBeenCalledWith('/6/2')
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenNthCalledWith(1, -1)
    expect(navigate).toHaveBeenNthCalledWith(2, 1)
    expect(applySettings).toHaveBeenCalledTimes(1)
    expect(applySettings).toHaveBeenCalledWith(expect.objectContaining({ flow: 'scrolled' }))
    expect(close).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  test('uses the Vue ebook session status to hide its ready loader without taking over the legacy loader', async () => {
    const pinia = createPinia()
    const reader = useReaderStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
    ebook.status = 'loading'
    reader.applyEbookSessionSnapshot(ebookSnapshot({ status: 'loading' }))
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('#loading-view').attributes('hidden')).toBeUndefined()
    ebook.status = 'ready'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#loading-view').attributes('hidden')).toBeDefined()

    ebook.record = null
    await wrapper.vm.$nextTick()
    const loader = wrapper.find('#loading-view').element as HTMLElement
    loader.hidden = false
    reader.applyLegacyState({ isReading: true })
    await wrapper.vm.$nextTick()
    expect(loader.hidden).toBe(false)
    loader.hidden = true
    reader.applyLegacyState({ chapter: 'PDF page 2' })
    await wrapper.vm.$nextTick()
    expect(loader.hidden).toBe(true)
    wrapper.unmount()
  })

  test('keeps an active ebook error visible with safe loader details and recovery actions', () => {
    const pinia = createPinia()
    const reader = useReaderStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    const error = ebookError('parse', 'EPUB manifest is unreadable')
    ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
    ebook.status = 'error'
    ebook.error = error
    reader.applyEbookSessionSnapshot(ebookSnapshot({ status: 'error', error }))
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(reader.isReading).toBe(false)
    expect(wrapper.find('#reader-view').attributes('hidden')).toBeUndefined()
    expect(wrapper.find('#loading-view').attributes('hidden')).toBeUndefined()
    expect(wrapper.find('#loading-view').attributes('data-state')).toBe('error')
    expect(wrapper.find('#loading-title').text()).toBe('无法解析这本书')
    expect(wrapper.find('#loading-detail').text()).toBe('文件内容无法解析。请确认文件完整后重试。')
    expect(wrapper.find('#loading-actions').attributes('hidden')).toBeUndefined()
    expect(wrapper.find('#loading-library-button').exists()).toBe(true)
    expect(wrapper.find('#loading-retry-button').exists()).toBe(true)
    wrapper.unmount()
  })

  test('renders only code-mapped ebook error copy when diagnostics contain hostile engine text', () => {
    const pinia = createPinia()
    const reader = useReaderStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    const rawEngineMessage = 'engine says <script>steal()</script> while parsing chapter 7'
    const error = {
      code: 'parse',
      title: '无法解析这本书',
      detail: '文件内容无法解析。请确认文件完整后重试。',
      diagnostic: rawEngineMessage,
    } as unknown as EbookSessionError
    ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
    ebook.status = 'error'
    ebook.error = error
    reader.applyEbookSessionSnapshot(ebookSnapshot({ status: 'error', error }))
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('#loading-title').text()).toBe('无法解析这本书')
    expect(wrapper.find('#loading-detail').text()).toBe('文件内容无法解析。请确认文件完整后重试。')
    expect(wrapper.text()).not.toContain(rawEngineMessage)
    wrapper.unmount()
  })

  test('uses Vue recovery controls to clear an ebook error before returning or retrying', async () => {
    const pinia = createPinia()
    const reader = useReaderStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    const library = useLibraryStore(pinia)
    const settings = useSettingsStore(pinia)
    const error = ebookError('parse', 'EPUB manifest is unreadable')
    let callbacks!: EbookSessionCallbacks
    let resolveOpening!: () => void
    const open = vi.fn(() => new Promise<void>(resolve => { resolveOpening = resolve }))
    ebook.attachPort(nextCallbacks => {
      callbacks = nextCallbacks
      return {
        open,
        close: vi.fn().mockResolvedValue(undefined),
        goTo: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        setFlow: vi.fn().mockResolvedValue(undefined),
        applySettings: vi.fn().mockResolvedValue(undefined),
        flushProgress: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
      }
    })
    const showError = () => {
      ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
      ebook.status = 'error'
      ebook.error = error
      reader.applyEbookSessionSnapshot(ebookSnapshot({ status: 'error', error }))
    }
    const load = vi.spyOn(library, 'load').mockResolvedValue(undefined)
    showError()
    reader.requestPanel('toc')
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    const legacyReturn = vi.fn()
    wrapper.find('#loading-library-button').element.addEventListener('click', legacyReturn)

    await wrapper.find('#loading-library-button').trigger('click')

    expect(legacyReturn).not.toHaveBeenCalled()
    expect(ebook.record).toBeNull()
    expect(ebook.status).toBe('idle')
    expect(ebook.error).toBeNull()
    expect(reader.activePanel).toBeNull()
    expect(wrapper.find('#reader-view').attributes('hidden')).toBeDefined()
    expect(wrapper.find('#welcome-view').attributes('hidden')).toBeUndefined()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    const reopening = ebook.open(libraryRecord('reopened.epub', 0, new Blob(['reopened'])), settings.settings)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#loading-view').attributes('hidden')).toBeUndefined()
    callbacks.onSnapshot(ebookSnapshot({ status: 'ready', generation: ebook.generation }))
    resolveOpening()
    await reopening
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#loading-view').attributes('hidden')).toBeDefined()

    showError()
    await wrapper.vm.$nextTick()
    const picker = vi.spyOn(wrapper.find<HTMLInputElement>('#file-input').element, 'click')
    const legacyRetry = vi.fn()
    wrapper.find('#loading-retry-button').element.addEventListener('click', legacyRetry)
    await wrapper.find('#loading-retry-button').trigger('click')

    expect(legacyRetry).not.toHaveBeenCalled()
    expect(ebook.record).toBeNull()
    expect(ebook.status).toBe('idle')
    expect(ebook.error).toBeNull()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(picker).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  test('uses the Vue ebook session reader state for footer progress without taking over the legacy footer', async () => {
    const pinia = createPinia()
    const reader = useReaderStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
    ebook.status = 'ready'
    reader.applyEbookSessionSnapshot(ebookSnapshot({
      status: 'ready',
      chapter: 'Chapter five',
      progress: 0.375,
    }))
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('#chapter-label').text()).toBe('Chapter five')
    expect((wrapper.find('#progress-slider').element as HTMLInputElement).value).toBe('0.375')
    expect(wrapper.find('#progress-label').text()).toBe('38%')

    ebook.record = null
    await wrapper.vm.$nextTick()
    const chapter = wrapper.find('#chapter-label').element
    const slider = wrapper.find('#progress-slider').element as HTMLInputElement
    const label = wrapper.find('#progress-label').element
    chapter.textContent = '第 7 页'
    slider.value = '0.7'
    label.textContent = '70%'
    reader.applyLegacyState({ chapter: 'legacy store update', progress: 0.2 })
    await wrapper.vm.$nextTick()
    expect(chapter.textContent).toBe('第 7 页')
    expect(slider.value).toBe('0.7')
    expect(label.textContent).toBe('70%')
    wrapper.unmount()
  })

  test('closes an active ebook panel and scrim before returning to the library', async () => {
    const pinia = createPinia()
    const reader = useReaderStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    const library = useLibraryStore(pinia)
    vi.spyOn(library, 'load').mockResolvedValue(undefined)
    ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
    ebook.status = 'ready'
    reader.applyEbookSessionSnapshot(ebookSnapshot({ status: 'ready' }))
    reader.requestPanel('toc')
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('#sidebar').classes()).toContain('open')
    expect(wrapper.find('#scrim').classes()).toContain('show')

    await wrapper.find('#home-button').trigger('click')

    expect(reader.activePanel).toBeNull()
    expect(wrapper.find('#sidebar').classes()).not.toContain('open')
    expect(wrapper.find('#scrim').classes()).not.toContain('show')
    wrapper.unmount()
  })

  test('renders and routes every nested ebook TOC level', async () => {
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'book', name: 'book.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.toc = [{
      label: 'Part one',
      href: '/6/2',
      subitems: [{
        label: 'Chapter one',
        href: '/6/4',
        subitems: [{ label: 'Section one', href: '/6/6' }],
      }],
    }]
    const goTo = vi.spyOn(ebook, 'goTo').mockResolvedValue(undefined)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    const tocButtons = wrapper.findAll('#toc button')
    expect(tocButtons).toHaveLength(3)
    expect(tocButtons.map(button => button.text())).toEqual(['Part one', 'Chapter one', 'Section one'])

    await tocButtons[2]!.trigger('click')

    expect(goTo).toHaveBeenCalledTimes(1)
    expect(goTo).toHaveBeenCalledWith('/6/6')
    wrapper.unmount()
  })

  test('renders panel classes from Pinia and closes panels through Vue controls', async () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    await wrapper.find('#sidebar-button').trigger('click')
    expect(store.activePanel).toBe('toc')
    expect(wrapper.find('#sidebar').classes()).toContain('open')
    expect(wrapper.find('#scrim').classes()).toContain('show')

    await wrapper.find('#settings-button').trigger('click')
    expect(store.activePanel).toBe('settings')
    expect(wrapper.find('#sidebar').classes()).not.toContain('open')
    expect(wrapper.find('#settings-panel').classes()).toContain('open')

    await wrapper.find('#close-settings').trigger('click')
    expect(store.activePanel).toBeNull()
    expect(wrapper.find('#settings-panel').classes()).not.toContain('open')
    expect(wrapper.find('#scrim').classes()).not.toContain('show')

    wrapper.unmount()
  })

  test('renders the real Pinia library projection and revokes cover URLs on updates and unmount', async () => {
    const createObjectURL = vi.fn((_: Blob) => `blob:cover-${createObjectURL.mock.calls.length}`)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const pinia = createPinia()
    const library = useLibraryStore(pinia)
    library.books = [libraryRecord('first.epub', 0.42, new Blob(['cover-one'], { type: 'image/png' }))]
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('#library-section').attributes('hidden')).toBeUndefined()
    expect(wrapper.findAll('.library-card')).toHaveLength(1)
    expect(wrapper.find('.card-title').text()).toBe('First title')
    expect(wrapper.find('.card-author').text()).toBe('First author')
    expect(wrapper.find('.card-meta').text()).toMatch(/EPUB.*4 B/)
    expect(wrapper.find('.card-progress span').attributes('style')).toContain('42%')
    expect(wrapper.find('.mini-cover img').attributes('src')).toBe('blob:cover-1')

    library.books = [libraryRecord('second.pdf', 0.1, new Blob(['cover-two'], { type: 'image/png' }))]
    await wrapper.vm.$nextTick()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
    expect(wrapper.find('.card-title').text()).toBe('Second title')

    wrapper.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cover-2')
  })

  test('routes hidden file input and drop events through the library store once', async () => {
    const pinia = createPinia()
    const library = useLibraryStore(pinia)
    const openFile = vi.spyOn(library, 'openFile').mockResolvedValue(undefined as never)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    const selected = new File(['selected'], 'selected.epub', { type: 'application/epub+zip' })
    const dropped = new File(['dropped'], 'dropped.pdf', { type: 'application/pdf' })
    const input = wrapper.find('#file-input')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [selected] })

    await input.trigger('change')
    await wrapper.find('#drop-zone').trigger('drop', { dataTransfer: { files: [dropped] } })

    expect(openFile).toHaveBeenCalledTimes(2)
    expect(openFile).toHaveBeenNthCalledWith(1, selected)
    expect(openFile).toHaveBeenNthCalledWith(2, dropped)
    expect(wrapper.find('#open-button').attributes('for')).toBe('file-input')
    expect(wrapper.find('#hero-open-button').attributes('for')).toBe('file-input')
    wrapper.unmount()
  })

  test('opens the file picker once and prevents default for keyboard file-open controls', async () => {
    const pinia = createPinia()
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    const input = wrapper.find<HTMLInputElement>('#file-input')
    const click = vi.spyOn(input.element, 'click')

    for (const selector of ['#open-button', '#hero-open-button']) {
      for (const key of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        const clicksBefore = click.mock.calls.length

        wrapper.find(selector).element.dispatchEvent(event)
        await wrapper.vm.$nextTick()

        expect(event.defaultPrevented).toBe(true)
        expect(click).toHaveBeenCalledTimes(clicksBefore + 1)
      }
    }

    wrapper.unmount()
  })

  test('clears the hidden file input on click before the next selection change', async () => {
    const pinia = createPinia()
    const library = useLibraryStore(pinia)
    const openFile = vi.spyOn(library, 'openFile')
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    const input = wrapper.find<HTMLInputElement>('#file-input')
    Object.defineProperty(input.element, 'value', {
      configurable: true,
      writable: true,
      value: 'C:\\fakepath\\same.epub',
    })

    await input.trigger('click')

    expect(input.element.value).toBe('')
    expect(openFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  test('closes the active panel from the scrim and Escape key', async () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    await wrapper.find('#tools-button').trigger('click')
    await wrapper.find('#scrim').trigger('click')
    expect(store.activePanel).toBeNull()

    await wrapper.find('#tools-button').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(store.activePanel).toBeNull()
    expect(wrapper.find('#tools-panel').classes()).not.toContain('open')

    wrapper.unmount()
  })

  test('binds settings controls to Pinia state and Vue events', async () => {
    localStorage.setItem('quiet-reader-settings', JSON.stringify({
      theme: 'sepia',
      flow: 'scrolled',
      font: 'system',
      fontSize: 24,
      lineHeight: 1.9,
      pageWidth: 880,
    }))
    const pinia = createPinia()
    const store = useSettingsStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('[data-theme="sepia"]').classes()).toContain('active')
    expect(wrapper.find('[data-flow="scrolled"]').classes()).toContain('active')
    expect((wrapper.find('#font-select').element as HTMLSelectElement).value).toBe('system')
    expect((wrapper.find('#font-size').element as HTMLInputElement).value).toBe('24')
    expect(wrapper.find('#line-height-value').text()).toBe('1.90')
    expect(wrapper.find('#page-width-value').text()).toBe('880')

    await wrapper.find('[data-theme="dark"]').trigger('click')
    await wrapper.find('[data-flow="paginated"]').trigger('click')
    expect(store.theme).toBe('dark')
    expect(store.flow).toBe('paginated')
    expect(wrapper.find('[data-theme="dark"]').classes()).toContain('active')
    expect(wrapper.find('[data-flow="paginated"]').classes()).toContain('active')

    wrapper.unmount()
  })

  test('persists the collapsed header state through the settings store', async () => {
    const pinia = createPinia()
    const store = useSettingsStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    await wrapper.find('#header-toggle').trigger('click')

    expect(store.headerCollapsed).toBe(true)
    expect(wrapper.find('#header-toggle').attributes('aria-expanded')).toBe('false')
    expect(JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}')).toMatchObject({ headerCollapsed: true })

    wrapper.unmount()
  })

  test('shows a persistent migration recovery view with safe actions', () => {
    const pinia = createPinia()
    const store = useMigrationStore(pinia)
    store.fail({
      code: 'missing-store',
      message: '数据库缺少 meta 对象仓库',
      diagnostic: {
        databaseExists: true,
        databaseVersion: 2,
        stores: ['books'],
        schemaVersion: null,
        bookCount: 1,
        settingsKey: 'quiet-reader-settings',
        settingsKeys: ['aiApiKey'],
        settingsWarnings: [],
      },
    })

    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    expect(wrapper.find('#migration-error-view').isVisible()).toBe(true)
    expect(wrapper.find('#migration-export-diagnostic').exists()).toBe(true)
    expect(wrapper.find('#migration-restore-backup').exists()).toBe(true)
    expect(wrapper.find('#migration-return-library').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('secret')
    expect(wrapper.find('#welcome-view').exists()).toBe(false)
    wrapper.unmount()
  })
})

function libraryRecord(name: string, fraction: number, cover: Blob): BookRecord {
  const format = name.endsWith('.pdf') ? 'pdf' : 'epub'
  const first = name.startsWith('first')
  return {
    id: `id-${name}`,
    name,
    type: format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
    size: 4,
    lastModified: 1,
    format,
    blob: new Blob(['book']),
    openedAt: 10,
    metadata: { title: first ? 'First title' : 'Second title', author: first ? 'First author' : 'Second author' },
    cover,
    progress: format === 'pdf'
      ? { kind: 'pdf', page: 2, fraction }
      : { kind: 'ebook', cfi: '/6/2', fraction },
  }
}

function ebookSnapshot(overrides: Partial<EbookSessionSnapshot> = {}): EbookSessionSnapshot {
  return {
    status: 'idle',
    title: 'Untitled',
    toc: [],
    chapter: '开始',
    progress: 0,
    flow: 'paginated',
    error: null,
    generation: 1,
    ...overrides,
  }
}

function ebookError(code: EbookSessionError['code'], diagnostic: string): EbookSessionError {
  const presentation = {
    format: {
      title: '不支持这个文件',
      detail: '请确认文件格式为 EPUB、MOBI 或 AZW3 后重试。',
    },
    parse: {
      title: '无法解析这本书',
      detail: '文件内容无法解析。请确认文件完整后重试。',
    },
    restore: {
      title: '无法恢复阅读位置',
      detail: '已保留这本书，请重新打开后从开头继续阅读。',
    },
    render: {
      title: '无法显示这本书',
      detail: '阅读视图无法建立。请重新打开书籍后重试。',
    },
  }[code]
  return { code, ...presentation, diagnostic }
}
