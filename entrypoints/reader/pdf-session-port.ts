import type { BookRecord } from '../../src/core/types'
import type { ReaderSettings } from './legacy-reader-port'

export type PdfSessionStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PdfOutlineItem {
  label: string
  page: number
  children?: PdfOutlineItem[]
}

export interface PdfSessionError {
  code: 'password' | 'parse' | 'render' | 'restore' | 'cancelled'
  title: string
  detail: string
  diagnostic: string
}

export interface PdfSessionSnapshot {
  status: PdfSessionStatus
  title: string
  outline: PdfOutlineItem[]
  page: number
  pageCount: number
  zoom: number
  progress: number
  error: PdfSessionError | null
  generation: number
}

export interface PdfSessionCallbacks {
  onSnapshot(snapshot: PdfSessionSnapshot): void
  onError(error: PdfSessionError, generation: number): void
}

export interface PdfSessionPort {
  open(record: BookRecord, settings: ReaderSettings): Promise<void>
  close(): Promise<void>
  goTo(page: number): Promise<void>
  navigate(direction: -1 | 1): Promise<void>
  setZoom(zoom: number): Promise<void>
  flushProgress(): Promise<void>
  readRenderedTextLayer(page: number): HTMLElement | null
  destroy(): void
}

export type PdfSessionPortFactory = (callbacks: PdfSessionCallbacks) => PdfSessionPort
