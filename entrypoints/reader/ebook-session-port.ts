import type { BookRecord } from '../../src/core/types'
import type { ReaderSettings } from './legacy-reader-port'

export type EbookSessionStatus = 'idle' | 'loading' | 'ready' | 'error'
export type EbookSessionFlow = 'paginated' | 'scrolled'

export interface EbookSessionTocItem {
  label: string
  href: unknown
  subitems?: EbookSessionTocItem[]
}

export interface EbookSessionError {
  code: 'format' | 'parse' | 'restore' | 'render'
  message: string
}

export interface EbookSessionSnapshot {
  status: EbookSessionStatus
  title: string
  toc: EbookSessionTocItem[]
  chapter: string
  progress: number
  flow: EbookSessionFlow
  error: EbookSessionError | null
  generation: number
}

export interface EbookSessionCallbacks {
  onSnapshot(snapshot: EbookSessionSnapshot): void
  onError(error: EbookSessionError, generation: number): void
}

export interface EbookSessionPort {
  open(record: BookRecord, settings: ReaderSettings): Promise<void>
  close(): Promise<void>
  goTo(target: unknown): Promise<void>
  navigate(direction: -1 | 1): Promise<void>
  setFlow(flow: EbookSessionFlow): Promise<void>
  applySettings(settings: ReaderSettings): Promise<void>
  flushProgress(): Promise<void>
  destroy(): void
}

export type EbookSessionPortFactory = (callbacks: EbookSessionCallbacks) => EbookSessionPort
