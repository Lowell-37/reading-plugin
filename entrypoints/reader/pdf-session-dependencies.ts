// @ts-expect-error PDF.js 6 does not declare its browser ESM build entrypoint.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import type { PdfSessionCallbacks } from './pdf-session-port'

export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>
  destroy?(): void | Promise<void>
}

export interface PdfDocumentLike {
  numPages: number
  getMetadata(): Promise<{ info?: { Title?: unknown } } | null>
  getOutline(): Promise<PdfOutlineSource[] | null>
  getDestination(name: string): Promise<unknown>
  getPageIndex(reference: object): Promise<number>
  getPage(page: number): Promise<PdfPageLike>
  destroy?(): void | Promise<void>
}

export interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number, height: number, scale: number }
  getTextContent(): Promise<unknown>
  render(options: { canvasContext: CanvasRenderingContext2D | null, viewport: unknown }): { promise: Promise<unknown>, cancel?(): void }
}

export interface PdfOutlineSource {
  title?: unknown
  dest?: unknown
  items?: PdfOutlineSource[]
}

export interface PdfJsLike {
  GlobalWorkerOptions?: { workerSrc: string }
  getDocument(options: {
    data: Uint8Array
    cMapUrl: string
    cMapPacked: boolean
    standardFontDataUrl: string
    wasmUrl: string
  }): PdfLoadingTaskLike
  TextLayer: new (options: {
    textContentSource: unknown
    container: HTMLElement
    viewport: unknown
  }) => { render(): Promise<unknown> }
}

export interface PdfProgressServiceLike {
  schedule(bookId: string, progress: { kind: 'pdf', page: number, fraction: number }): boolean
  flush(): Promise<boolean>
  cancel(): void
}

export interface PdfSessionHost {
  pages: HTMLElement
  viewport: HTMLElement
}

export interface PdfObserverLike {
  observe(target: Element): void
  disconnect(): void
}

export interface PdfSessionDependencies extends PdfSessionCallbacks {
  baseUrl: string
  host: PdfSessionHost
  loadPdfJs(): Promise<PdfJsLike>
  nextGeneration(): number
  createObserver(callback: IntersectionObserverCallback): PdfObserverLike
  requestFrame(callback: FrameRequestCallback): number
  cancelFrame(handle: number): void
  pixelRatio(): number
  createProgressService(): PdfProgressServiceLike
}

export type PdfSessionRuntimeOptions = Omit<
  PdfSessionDependencies,
  'loadPdfJs'
>

/** Keeps the PDF.js import and browser worker configuration outside Vue and Pinia. */
export function createPdfSessionDependencies(
  options: PdfSessionRuntimeOptions,
): PdfSessionDependencies {
  return {
    ...options,
    loadPdfJs: async () => pdfjs as unknown as PdfJsLike,
  }
}
