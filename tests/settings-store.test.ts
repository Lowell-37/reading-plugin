// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { EbookSessionError, EbookSessionPort } from '../entrypoints/reader/ebook-session-port'
import type { LegacyReaderPort, ReaderSettings } from '../entrypoints/reader/legacy-reader-port'
import { useEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import { useSettingsStore } from '../entrypoints/reader/stores/settings'

afterEach(() => {
  localStorage.clear()
  document.body.className = ''
  vi.restoreAllMocks()
})

describe('reader settings store', () => {
  test('loads normalized settings while retaining unknown persisted fields', () => {
    localStorage.setItem('quiet-reader-settings', JSON.stringify({
      theme: 'invalid',
      flow: 'scrolled',
      fontSize: 999,
      customReaderFlag: 'keep-me',
    }))

    const store = useSettingsStore(createPinia())

    expect(store.settings).toMatchObject({
      theme: 'paper',
      flow: 'scrolled',
      fontSize: 20,
      customReaderFlag: 'keep-me',
    })
  })

  test.each([
    ['updateTheme', 'dark', 'theme'],
    ['updateFlow', 'scrolled', 'flow'],
    ['updateFont', 'sans', 'font'],
    ['updateFontSize', 26, 'fontSize'],
    ['updateLineHeight', 2, 'lineHeight'],
    ['updatePageWidth', 900, 'pageWidth'],
    ['updateHeaderCollapsed', true, 'headerCollapsed'],
  ] as const)('persists once before applying %s through the reader port', async (action, value, key) => {
    localStorage.setItem('quiet-reader-settings', JSON.stringify({ customReaderFlag: 'keep-me' }))
    const store = useSettingsStore(createPinia())
    const applied: ReaderSettings[] = []
    const port = createPort(async settings => {
      expect(JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}')).toEqual(settings)
      applied.push(settings)
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    store.attachPort(port)

    await store[action](value as never)

    expect(setItem).toHaveBeenCalledTimes(1)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ [key]: value, customReaderFlag: 'keep-me' })
    expect(store.settings).toMatchObject({ [key]: value, customReaderFlag: 'keep-me' })
  })

  test.each([
    ['updateTheme', 'dark', 'theme'],
    ['updateFlow', 'scrolled', 'flow'],
    ['updateFont', 'sans', 'font'],
    ['updateFontSize', 26, 'fontSize'],
    ['updateLineHeight', 2, 'lineHeight'],
    ['updatePageWidth', 900, 'pageWidth'],
  ] as const)('applies %s exactly once to both legacy and active ebook sessions', async (action, value, key) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSettingsStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    const legacyApply = vi.fn(async () => undefined)
    const ebookApply = vi.fn(async () => undefined)
    ebook.record = { id: 'active', name: 'active.epub', format: 'epub' }
    ebook.attachPort(() => createEbookPort(ebookApply))
    store.attachPort(createPort(legacyApply))

    await store[action](value as never)

    expect(legacyApply).toHaveBeenCalledTimes(1)
    expect(legacyApply).toHaveBeenCalledWith(expect.objectContaining({ [key]: value }))
    expect(ebookApply).toHaveBeenCalledTimes(1)
    expect(ebookApply).toHaveBeenCalledWith(expect.objectContaining({ [key]: value }))
  })

  test('contains a projected flow failure without an unhandled rejection', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSettingsStore(pinia)
    const ebook = useEbookSessionStore(pinia)
    const rawEngineMessage = 'untrusted engine failure: <img src=x onerror=alert(1)>'
    const error = {
      code: 'render',
      title: '无法显示这本书',
      detail: '阅读视图无法建立。请重新打开书籍后重试。',
      diagnostic: rawEngineMessage,
    } as unknown as EbookSessionError
    const unhandled: PromiseRejectionEvent[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event)
    window.addEventListener('unhandledrejection', onUnhandled)
    ebook.record = { id: 'active', name: 'active.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.attachPort(callbacks => createEbookPort(async () => {
      callbacks.onError(error, ebook.generation)
      throw new Error(rawEngineMessage)
    }))

    try {
      await expect(store.updateFlow('scrolled')).resolves.toBe(true)
      await Promise.resolve()

      expect(ebook.status).toBe('error')
      expect(ebook.error).toEqual(error)
      expect(unhandled).toEqual([])
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  })

  test('rejects invalid known updates without persisting or applying them', async () => {
    const store = useSettingsStore(createPinia())
    const applySettings = vi.fn(async () => undefined)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    store.attachPort(createPort(applySettings))

    await store.updateFontSize(99)
    await store.updateFlow('sideways' as never)

    expect(store.fontSize).toBe(20)
    expect(store.flow).toBe('paginated')
    expect(setItem).not.toHaveBeenCalled()
    expect(applySettings).not.toHaveBeenCalled()
  })
})

function createPort(applySettings: LegacyReaderPort['applySettings']): LegacyReaderPort {
  return {
    openRecord: async () => undefined,
    closeSession: async () => undefined,
    applySettings,
    flushProgress: async () => undefined,
    destroy() {},
  }
}

function createEbookPort(applySettings: EbookSessionPort['applySettings']): EbookSessionPort {
  return {
    open: async () => undefined,
    close: async () => undefined,
    goTo: async () => undefined,
    navigate: async () => undefined,
    setFlow: async () => undefined,
    applySettings,
    flushProgress: async () => undefined,
    destroy() {},
  }
}
