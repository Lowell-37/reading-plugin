export type BookFormat = 'pdf' | 'epub' | 'mobi' | 'azw3'
export type EbookFormat = Exclude<BookFormat, 'pdf'>

export interface EbookLocation {
  kind: 'ebook'
  cfi: string | null
  fraction: number
}

export interface PdfLocation {
  kind: 'pdf'
  page: number
  fraction: number
}

export type ReadingLocation = EbookLocation | PdfLocation

export interface BookMetadata {
  title: string
  author: string
}

export interface BookRecord {
  id: string
  name: string
  type: string
  size: number
  lastModified: number
  format: BookFormat
  blob: Blob
  openedAt: number
  metadata?: BookMetadata
  cover?: Blob | null
  progress?: ReadingLocation
  annotations?: Annotation[]
}

export interface TocItem {
  label?: string
  href?: unknown
  subitems?: TocItem[]
}

export interface AnnotationRect {
  left: number
  top: number
  width: number
  height: number
}

export interface TextQuoteAnchor {
  exact: string
  prefix: string
  suffix: string
  normalizedExact: string
}

export interface EbookAnnotationAnchor {
  version: 1
  kind: 'ebook'
  section: number | null
  cfi: string | null
  textOffset: number | null
  quote: TextQuoteAnchor
}

export interface PdfAnnotationAnchor {
  version: 1
  kind: 'pdf'
  page: number
  textOffset: number | null
  quote: TextQuoteAnchor
}

export type AnnotationAnchor = EbookAnnotationAnchor | PdfAnnotationAnchor

export interface Annotation {
  id: string
  kind: 'ebook' | 'pdf'
  locator: string | null
  page: number | null
  section: number | null
  text: string
  note: string
  color: string
  rects: AnnotationRect[]
  createdAt: number
  updatedAt?: number
  tags?: string[]
  anchor?: AnnotationAnchor
  anchorStatus?: 'resolved' | 'unresolved'
}

export type AiScope = 'selection' | 'chapter'
export type SelectionAiAction = 'explain' | 'translate' | 'simplify' | 'terms' | 'background'
export type ChapterAiAction = 'summary' | 'keyPoints' | 'characters' | 'timeline' | 'concepts'
export type AiAction = SelectionAiAction | ChapterAiAction

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  scope: AiScope
  action: AiAction
  text: string
  title?: string
  chapter?: string
}
