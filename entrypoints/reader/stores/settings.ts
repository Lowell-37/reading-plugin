import { computed, reactive } from 'vue'
import { defineStore } from 'pinia'
import { normalizeReaderSettings } from '../../../src/core/migration-preflight'
import type { LegacyReaderPort, ReaderSettings } from '../legacy-reader-port'
import { loadReaderSettings, saveReaderSettings } from '../settings-persistence'
import { useEbookSessionStore } from './ebook-session'

export type ReaderTheme = 'paper' | 'light' | 'sepia' | 'dark'
export type ReaderFlow = 'paginated' | 'scrolled'
export type ReaderFont = 'serif' | 'sans' | 'system'

type SettingsKey = 'theme' | 'flow' | 'font' | 'fontSize' | 'lineHeight' | 'pageWidth' | 'headerCollapsed'

export const useSettingsStore = defineStore('settings', () => {
  const settings = reactive<ReaderSettings>({ ...loadReaderSettings() })
  let port: LegacyReaderPort | null = null

  const theme = computed(() => settings.theme as ReaderTheme)
  const flow = computed(() => settings.flow as ReaderFlow)
  const font = computed(() => settings.font as ReaderFont)
  const fontSize = computed(() => settings.fontSize as number)
  const lineHeight = computed(() => settings.lineHeight as number)
  const pageWidth = computed(() => settings.pageWidth as number)
  const headerCollapsed = computed(() => settings.headerCollapsed as boolean)

  function attachPort(nextPort: LegacyReaderPort | null) {
    port = nextPort
  }

  async function update<K extends SettingsKey>(key: K, value: unknown) {
    const normalized = normalizeReaderSettings({ ...settings, [key]: value })
    if (normalized.warnings.includes(key)) return false

    const nextSettings = normalized.settings
    saveReaderSettings(nextSettings)
    Object.assign(settings, nextSettings)
    await applyToReaders(nextSettings)
    return true
  }

  async function restoreNonSensitive(restored: ReaderSettings) {
    const { aiApiKey: _excludedApiKey, ...safeRestored } = restored
    const normalized = normalizeReaderSettings({ ...settings, ...safeRestored })
    const nextSettings = normalized.settings
    saveReaderSettings(nextSettings)
    Object.assign(settings, nextSettings)
    await applyToReaders(nextSettings)
    return { ...nextSettings }
  }

  async function applyToReaders(nextSettings: ReaderSettings) {
    const applications: Promise<unknown>[] = []
    if (port) applications.push(port.applySettings({ ...nextSettings }))
    const ebook = useEbookSessionStore()
    if (ebook.record) applications.push(ebook.applySettings({ ...nextSettings }))
    await Promise.allSettled(applications)
  }

  return {
    settings,
    theme,
    flow,
    font,
    fontSize,
    lineHeight,
    pageWidth,
    headerCollapsed,
    attachPort,
    restoreNonSensitive,
    updateTheme: (value: ReaderTheme) => update('theme', value),
    updateFlow: (value: ReaderFlow) => update('flow', value),
    updateFont: (value: ReaderFont) => update('font', value),
    updateFontSize: (value: number) => update('fontSize', value),
    updateLineHeight: (value: number) => update('lineHeight', value),
    updatePageWidth: (value: number) => update('pageWidth', value),
    updateHeaderCollapsed: (value: boolean) => update('headerCollapsed', value),
    toggleHeaderCollapsed: () => update('headerCollapsed', !headerCollapsed.value),
  }
})
