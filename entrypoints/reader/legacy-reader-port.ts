import type { BookRecord } from '../../src/core/types'

export type ReaderPanel = 'toc' | 'settings' | 'tools' | null

export interface LegacyReaderState {
  title: string
  chapter: string
  progress: number
  isReading: boolean
}

export type ReaderSettings = Record<string, unknown>

export interface LegacyReaderCallbacks {
  onState(state: Partial<LegacyReaderState>): void
  onPanelRequest(panel: ReaderPanel): void
  onLibraryChanged(): void | Promise<void>
}

/** Engine-only boundary. In WXT mode, Vue owns all migrated UI listeners. */
export interface LegacyReaderPort {
  openRecord(record: BookRecord, options?: { newlySaved?: boolean }): Promise<void>
  closeSession(): Promise<void>
  applySettings(settings: ReaderSettings): Promise<void>
  flushProgress(): Promise<void>
  destroy(): void
}
