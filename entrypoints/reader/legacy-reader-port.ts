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

/** Value identity and rendered DOM only: the PDF session retains all engine resources. */
export type LegacyPdfToolRecord = Pick<BookRecord, 'id' | 'name' | 'format' | 'metadata' | 'annotations'>

export interface LegacyPdfAnnotationTools {
  pageCount(): number
  readTextLayer(page: number): HTMLElement | null
  goTo(page: number): Promise<void>
}

/** WXT legacy tools boundary; typed sessions own both PDF and ebook engines. */
export interface LegacyReaderPort {
  openRecord(record: BookRecord, options?: { newlySaved?: boolean }): Promise<void>
  closeSession(): Promise<void>
  applySettings(settings: ReaderSettings): Promise<void>
  flushProgress(): Promise<void>
  destroy(): void
  attachPdfTools?(record: LegacyPdfToolRecord | null, tools?: LegacyPdfAnnotationTools): void
}
