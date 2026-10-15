// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { expect, test } from 'vitest'
import { useLibraryStore } from '../entrypoints/reader/stores/library'
import { useSettingsStore } from '../entrypoints/reader/stores/settings'

test('active WXT stores expose no legacy controller attachment path', () => {
  const pinia = createPinia()
  setActivePinia(pinia)

  expect('attachLegacyPort' in useLibraryStore(pinia)).toBe(false)
  expect('attachPort' in useLibraryStore(pinia)).toBe(false)
  expect('attachPort' in useSettingsStore(pinia)).toBe(false)
})
