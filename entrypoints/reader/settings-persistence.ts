// @ts-expect-error JavaScript compatibility storage has no declaration file yet.
import { loadSettings, saveSettings } from '../../src/storage.js'
import type { ReaderSettings } from './legacy-reader-port'

/** Keeps browser storage behind a non-Vue composition boundary. */
export function loadReaderSettings(): ReaderSettings {
  return loadSettings() as ReaderSettings
}

/** Keeps browser storage behind a non-Vue composition boundary. */
export function saveReaderSettings(settings: ReaderSettings): void {
  saveSettings(settings)
}
