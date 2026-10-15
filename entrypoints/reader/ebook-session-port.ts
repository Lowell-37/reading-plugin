import type { BookRecord } from '../../src/core/types'
import type { Annotation, EbookAnnotationAnchor } from '../../src/core/types'
import type { ReaderSettings } from './reader-types'
import type { EbookSearchOptions, EbookSearchSnapshot } from '../../src/core/ebook-search-index'

export type EbookSessionStatus = 'idle' | 'loading' | 'ready' | 'error'
export type EbookSessionFlow = 'paginated' | 'scrolled'
export type EbookSessionNavigationTarget = string | number | boolean | null
  | readonly EbookSessionNavigationTarget[]
  | { readonly [key: string]: EbookSessionNavigationTarget }

export interface EbookSessionTocItem {
  label: string
  href: EbookSessionNavigationTarget
  subitems?: EbookSessionTocItem[]
}

export interface EbookSessionError {
  code: 'format' | 'parse' | 'restore' | 'render'
  title: string
  detail: string
  diagnostic: string
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
  onAnnotationRepair?(annotation: Annotation, generation: number): void
}

export interface EbookSelectionInput {
  locator: string
  section: number
  text: string
  anchor?: EbookAnnotationAnchor
}

export interface EbookSessionPort {
  open(record: BookRecord, settings: ReaderSettings): Promise<void>
  close(): Promise<void>
  goTo(target: unknown): Promise<void>
  navigate(direction: -1 | 1): Promise<void>
  search(query: string, options?: EbookSearchOptions): Promise<EbookSearchSnapshot>
  consumeSelection(): EbookSelectionInput | null
  setAnnotations(annotations: Annotation[]): Promise<void>
  setFlow(flow: EbookSessionFlow): Promise<void>
  applySettings(settings: ReaderSettings): Promise<void>
  flushProgress(): Promise<void>
  destroy(): void
}

export type EbookSessionPortFactory = (callbacks: EbookSessionCallbacks) => EbookSessionPort
