// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LegacyReaderPort, ReaderSettings } from '../entrypoints/reader/legacy-reader-port'
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
