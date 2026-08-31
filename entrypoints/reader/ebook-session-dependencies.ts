// foliate-js does not publish TypeScript declarations.
// @ts-expect-error JavaScript engine dependency has no declaration file.
import { View } from 'foliate-js/view.js'
// @ts-expect-error JavaScript engine dependency has no declaration file.
import { ContinuousEbookScroller } from '../../src/continuous-ebook.js'
import type {
  EbookSessionCallbacks,
} from './ebook-session-port'

export interface EbookLocationLike {
  cfi?: string | null
  fraction?: number
  tocItem?: { label?: unknown } | null
}

export interface EbookRendererLike {
  setAttribute(name: string, value: string): void
  setStyles?(styles: string): void
}

export interface EbookViewLike extends EventTarget {
  book: {
    metadata?: { title?: unknown }
    toc?: Array<{ label?: unknown, href?: unknown, subitems?: unknown[] }>
    sections?: Array<{ linear?: string }>
  }
  renderer: EbookRendererLike
  style: { display: string, removeProperty(name: string): string }
  lastLocation?: EbookLocationLike | null
  open(blob: Blob): unknown
  goTo(target: unknown): unknown
  goToFraction(fraction: number): unknown
  goToTextStart(): unknown
  goLeft(): unknown
  goRight(): unknown
  close(): unknown
  remove(): void
}

export interface EbookScrollerOptions {
  host: EbookSessionHost
  view: EbookViewLike
  styles: string
}

export interface EbookScrollerLike extends EventTarget {
  mount(target?: unknown): unknown
  currentLocation(): EbookLocationLike | null
  goTo(target: unknown): unknown
  goToFraction(fraction: number): unknown
  scrollByPage(direction: -1 | 1): unknown
  setStyles(styles: string): void
  destroy(): void
}

export interface EbookProgressServiceLike {
  schedule(bookId: string, progress: {
    kind: 'ebook'
    cfi: string | null
    fraction: number
  }): boolean
  flush(): Promise<boolean>
  cancel(): void
}

export interface EbookSessionHost {
  append(node: unknown): void
}

export interface FoliateEbookSessionDependencies extends EbookSessionCallbacks {
  host: EbookSessionHost
  createView(): EbookViewLike
  createScroller(options: EbookScrollerOptions): EbookScrollerLike
  createProgressService(): EbookProgressServiceLike
  nextGeneration(): number
}

export type FoliateEbookSessionRuntimeOptions = Pick<
  FoliateEbookSessionDependencies,
  'host' | 'createProgressService' | 'nextGeneration' | 'onSnapshot' | 'onError'
>

/** Keeps concrete engine imports out of Pinia and Vue code. */
export function createFoliateEbookSessionDependencies(
  options: FoliateEbookSessionRuntimeOptions,
): FoliateEbookSessionDependencies {
  return {
    ...options,
    createView: () => new View() as EbookViewLike,
    createScroller: scrollerOptions => new ContinuousEbookScroller(scrollerOptions) as EbookScrollerLike,
  }
}
