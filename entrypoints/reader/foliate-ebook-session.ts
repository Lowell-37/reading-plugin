import type { BookRecord, ReadingLocation } from '../../src/core/types'
import type {
  EbookSessionError,
  EbookSessionFlow,
  EbookSessionNavigationTarget,
  EbookSessionPort,
  EbookSessionSnapshot,
  EbookSessionTocItem,
} from './ebook-session-port'
import type { ReaderSettings } from './legacy-reader-port'
import type {
  EbookLocationLike,
  EbookScrollerLike,
  EbookViewLike,
  FoliateEbookSessionDependencies,
} from './ebook-session-dependencies'

const DEFAULT_SETTINGS = {
  theme: 'paper',
  flow: 'paginated',
  font: 'serif',
  fontSize: 20,
  lineHeight: 1.75,
  pageWidth: 760,
} as const

export function createFoliateEbookSession(
  dependencies: FoliateEbookSessionDependencies,
): EbookSessionPort {
  const progressService = dependencies.createProgressService()
  let activeGeneration = 0
  let currentFlow: EbookSessionFlow = 'paginated'
  let currentRecord: BookRecord | null = null
  let currentScroller: EbookScrollerLike | null = null
  let currentSettings: ReaderSettings = { ...DEFAULT_SETTINGS }
  let currentSnapshot: EbookSessionSnapshot | null = null
  let currentView: EbookViewLike | null = null
  let acceptRelocations = false
  let viewRelocateListener: EventListener | null = null
  let scrollerRelocateListener: EventListener | null = null

  async function open(record: BookRecord, settings: ReaderSettings): Promise<void> {
    const generation = dependencies.nextGeneration()
    activeGeneration = generation
    await releaseResources()
    if (generation !== activeGeneration) return

    currentRecord = record
    currentSettings = { ...DEFAULT_SETTINGS, ...settings }
    currentFlow = 'paginated'
    currentSnapshot = createLoadingSnapshot(record, currentSettings, generation)
    dependencies.onSnapshot(currentSnapshot)

    const view = dependencies.createView()
    currentView = view
    dependencies.host.append(view)
    viewRelocateListener = createRelocateListener('view', generation)
    view.addEventListener('relocate', viewRelocateListener)

    let phase: EbookSessionError['code'] = 'parse'
    try {
      await view.open(record.blob)
      if (generation !== activeGeneration || currentView !== view) return

      phase = 'render'
      applyPaginatedSettings(view, currentSettings)

      phase = 'restore'
      await restorePosition(view, record.progress)
      if (generation !== activeGeneration || currentView !== view) return

      if (settingFlow(currentSettings) === 'scrolled') {
        phase = 'render'
        await enterScrolledFlow(view.lastLocation ?? record.progress ?? null, generation)
        if (generation !== activeGeneration || currentView !== view) return
      }

      const location = activeLocation()
      currentSnapshot = {
        status: 'ready',
        title: displayEngineValue(view.book.metadata?.title)
          || displayEngineValue(record.metadata?.title)
          || titleFromName(record.name),
        toc: copyTocForSnapshot(view.book.toc),
        chapter: displayEngineValue(location?.tocItem?.label) || '开始',
        progress: normalizeFraction(location?.fraction ?? record.progress?.fraction),
        flow: currentFlow,
        error: null,
        generation,
      }
      acceptRelocations = true
      dependencies.onSnapshot(currentSnapshot)
    } catch (cause) {
      if (generation !== activeGeneration) return
      const error = sessionError(phase, cause)
      acceptRelocations = false
      dependencies.onError(error, generation)
      await releaseResources()
    }
  }

  async function close(): Promise<void> {
    activeGeneration = dependencies.nextGeneration()
    if (!hasResources()) return
    await releaseResources()
  }

  async function goTo(target: unknown): Promise<void> {
    if (currentScroller) await currentScroller.goTo(target)
    else if (currentView) await currentView.goTo(target)
  }

  async function navigate(direction: -1 | 1): Promise<void> {
    if (currentScroller) await currentScroller.scrollByPage(direction)
    else if (direction < 0) await currentView?.goLeft()
    else await currentView?.goRight()
  }

  async function setFlow(flow: EbookSessionFlow): Promise<void> {
    if (!currentView || flow === currentFlow) return
    const generation = activeGeneration
    try {
      if (flow === 'scrolled') await enterScrolledFlow(currentView.lastLocation ?? null, generation)
      else await leaveScrolledFlow(generation)
    } catch (cause) {
      if (generation === activeGeneration) {
        dependencies.onError(sessionError('render', cause), generation)
      }
      throw cause
    }
    if (generation !== activeGeneration || !currentSnapshot) return
    currentSettings = { ...currentSettings, flow }
    currentSnapshot = snapshotAtActiveLocation({ ...currentSnapshot, flow })
    dependencies.onSnapshot(currentSnapshot)
  }

  async function applySettings(settings: ReaderSettings): Promise<void> {
    currentSettings = { ...DEFAULT_SETTINGS, ...settings }
    if (!currentView) return
    applyPaginatedSettings(currentView, currentSettings)
    currentScroller?.setStyles(createBookStyles(currentSettings, true))
    const flow = settingFlow(currentSettings)
    if (flow !== currentFlow) await setFlow(flow)
  }

  async function flushProgress(): Promise<void> {
    await progressService.flush()
  }

  function destroy(): void {
    if (!hasResources()) return
    activeGeneration = dependencies.nextGeneration()
    acceptRelocations = false
    detachListeners()
    const scroller = currentScroller
    const view = currentView
    currentScroller = null
    currentView = null
    currentRecord = null
    currentSnapshot = null
    void progressService.flush().catch(cause => {
      dependencies.onError(sessionError('render', cause), activeGeneration)
    })
    scroller?.destroy()
    view?.close()
    view?.remove()
  }

  function createRelocateListener(source: 'view' | 'scroller', generation: number): EventListener {
    return ((event: Event) => {
      if (generation !== activeGeneration || !acceptRelocations) return
      if (source === 'view' && currentScroller) return
      const detail = (event as CustomEvent<EbookLocationLike>).detail
      if (!detail || !currentRecord || !currentSnapshot) return
      const fraction = normalizeFraction(detail.fraction)
      const cfi = typeof detail.cfi === 'string' && detail.cfi ? detail.cfi : null
      currentSnapshot = {
        ...currentSnapshot,
        chapter: displayEngineValue(detail.tocItem?.label) || '正文',
        progress: fraction,
        flow: currentFlow,
      }
      dependencies.onSnapshot(currentSnapshot)
      progressService.schedule(currentRecord.id, { kind: 'ebook', cfi, fraction })
    }) as EventListener
  }

  async function enterScrolledFlow(target: unknown, generation: number): Promise<void> {
    const view = currentView
    if (!view || currentScroller) return
    acceptRelocations = false
    view.style.display = 'none'
    const scroller = dependencies.createScroller({
      host: dependencies.host,
      view,
      styles: createBookStyles(currentSettings, true),
    })
    const listener = createRelocateListener('scroller', generation)
    currentScroller = scroller
    scrollerRelocateListener = listener
    scroller.addEventListener('relocate', listener)
    try {
      await scroller.mount(target)
      if (generation !== activeGeneration || currentScroller !== scroller) {
        scroller.removeEventListener('relocate', listener)
        scroller.destroy()
        return
      }
      currentFlow = 'scrolled'
      acceptRelocations = currentSnapshot?.status === 'ready'
    } catch (cause) {
      scroller.removeEventListener('relocate', listener)
      if (currentScroller === scroller) currentScroller = null
      if (scrollerRelocateListener === listener) scrollerRelocateListener = null
      scroller.destroy()
      view.style.removeProperty('display')
      acceptRelocations = currentSnapshot?.status === 'ready'
      throw cause
    }
  }

  async function leaveScrolledFlow(generation: number): Promise<void> {
    const view = currentView
    const scroller = currentScroller
    if (!view || !scroller) return
    const location = scroller.currentLocation()
    acceptRelocations = false
    if (scrollerRelocateListener) scroller.removeEventListener('relocate', scrollerRelocateListener)
    scrollerRelocateListener = null
    currentScroller = null
    scroller.destroy()
    view.style.removeProperty('display')
    if (location?.cfi) await view.goTo(location.cfi)
    else if (typeof location?.fraction === 'number') await view.goToFraction(normalizeFraction(location.fraction))
    if (generation !== activeGeneration) return
    currentFlow = 'paginated'
    acceptRelocations = currentSnapshot?.status === 'ready'
  }

  async function releaseResources(): Promise<void> {
    if (!hasResources()) return
    acceptRelocations = false
    detachListeners()
    const scroller = currentScroller
    const view = currentView
    currentScroller = null
    currentView = null
    currentRecord = null
    currentSnapshot = null
    try {
      await progressService.flush()
    } finally {
      scroller?.destroy()
      view?.close()
      view?.remove()
    }
  }

  function detachListeners() {
    if (currentView && viewRelocateListener) currentView.removeEventListener('relocate', viewRelocateListener)
    if (currentScroller && scrollerRelocateListener) {
      currentScroller.removeEventListener('relocate', scrollerRelocateListener)
    }
    viewRelocateListener = null
    scrollerRelocateListener = null
  }

  function hasResources() {
    return Boolean(currentRecord || currentView || currentScroller || currentSnapshot)
  }

  function activeLocation(): EbookLocationLike | null {
    return currentScroller?.currentLocation() ?? currentView?.lastLocation ?? null
  }

  function snapshotAtActiveLocation(snapshot: EbookSessionSnapshot): EbookSessionSnapshot {
    const location = activeLocation()
    if (!location) return snapshot
    return {
      ...snapshot,
      chapter: displayEngineValue(location.tocItem?.label) || snapshot.chapter,
      progress: normalizeFraction(location.fraction ?? snapshot.progress),
    }
  }

  return {
    open,
    close,
    goTo,
    navigate,
    setFlow,
    applySettings,
    flushProgress,
    destroy,
  }
}

function createLoadingSnapshot(
  record: BookRecord,
  settings: ReaderSettings,
  generation: number,
): EbookSessionSnapshot {
  return {
    status: 'loading',
    title: displayEngineValue(record.metadata?.title) || titleFromName(record.name),
    toc: [],
    chapter: '开始',
    progress: normalizeFraction(record.progress?.fraction),
    flow: settingFlow(settings),
    error: null,
    generation,
  }
}

function restorePosition(view: EbookViewLike, progress: ReadingLocation | undefined): Promise<unknown> {
  if (progress?.kind === 'ebook' && progress.cfi) return Promise.resolve(view.goTo(progress.cfi))
  if (progress?.kind === 'ebook' && progress.fraction > 0) {
    return Promise.resolve(view.goToFraction(normalizeFraction(progress.fraction)))
  }
  return Promise.resolve(view.goToTextStart())
}

function applyPaginatedSettings(view: EbookViewLike, settings: ReaderSettings) {
  const pageWidth = finiteNumber(settings.pageWidth, DEFAULT_SETTINGS.pageWidth)
  view.renderer.setAttribute('flow', 'paginated')
  view.renderer.setAttribute('animated', '')
  view.renderer.setAttribute('margin', '64px')
  view.renderer.setAttribute('gap', '7%')
  view.renderer.setAttribute('max-inline-size', `${pageWidth}px`)
  view.renderer.setAttribute('max-column-count', '2')
  view.renderer.setStyles?.(createBookStyles(settings, false))
}

function createBookStyles(settings: ReaderSettings, continuous: boolean): string {
  const theme = String(settings.theme ?? DEFAULT_SETTINGS.theme)
  const colors = {
    paper: { background: '#f4f0e8', text: '#29251f', link: '#9b4932' },
    light: { background: '#ffffff', text: '#202124', link: '#3f6751' },
    sepia: { background: '#e9ddc4', text: '#3a3023', link: '#8c4e2d' },
    dark: { background: '#1e201d', text: '#e5e2d8', link: '#e19a7f' },
  }[theme] ?? { background: '#f4f0e8', text: '#29251f', link: '#9b4932' }
  const font = String(settings.font ?? DEFAULT_SETTINGS.font)
  const fontFamily = {
    serif: 'ui-serif, "Noto Serif SC", "Songti SC", STSong, Georgia, serif',
    sans: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  }[font] ?? 'ui-serif, "Noto Serif SC", "Songti SC", STSong, Georgia, serif'
  const fontSize = finiteNumber(settings.fontSize, DEFAULT_SETTINGS.fontSize)
  const lineHeight = finiteNumber(settings.lineHeight, DEFAULT_SETTINGS.lineHeight)
  const pageWidth = finiteNumber(settings.pageWidth, DEFAULT_SETTINGS.pageWidth)
  return `
    :root { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }
    html, body { background: ${colors.background} !important; color: ${colors.text} !important; }
    body { font-family: ${fontFamily} !important; font-size: ${fontSize}px !important;${continuous
      ? ` width:min(calc(100% - 48px), ${pageWidth}px) !important; max-width:${pageWidth}px !important;`
      : ''} }
    p, li, blockquote, dd { line-height: ${lineHeight} !important; text-align: justify; }
    a:link, a:visited { color: ${colors.link}; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
  `
}

function settingFlow(settings: ReaderSettings): EbookSessionFlow {
  return settings.flow === 'scrolled' ? 'scrolled' : 'paginated'
}

function normalizeFraction(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || '未命名书籍'
}

function sessionError(code: EbookSessionError['code'], cause: unknown): EbookSessionError {
  const message = cause instanceof Error && cause.message ? cause.message : '无法打开电子书'
  return { code, message }
}

function copyTocForSnapshot(
  items: EbookViewLike['book']['toc'],
): EbookSessionTocItem[] {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => ({
    label: displayEngineValue(item.label) || `章节 ${index + 1}`,
    href: copyNavigationTarget(item.href),
    ...(Array.isArray(item.subitems)
      ? { subitems: copyTocForSnapshot(item.subitems as NonNullable<typeof items>) }
      : {}),
  }))
}

function displayEngineValue(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(displayEngineValue).filter(Boolean).join('、')
  if (typeof value !== 'object') return ''
  if ('name' in value) return displayEngineValue(value.name)
  const first = Object.values(value).find(item => typeof item === 'string')
  return typeof first === 'string' ? first : ''
}

function copyNavigationTarget(target: unknown): EbookSessionNavigationTarget {
  if (target === null || typeof target === 'string' || typeof target === 'boolean') return target
  if (typeof target === 'number') return Number.isFinite(target) ? target : null
  if (Array.isArray(target)) return Object.freeze(target.map(copyNavigationTarget))
  if (!isPlainRecord(target)) return null

  const copy: Record<string, EbookSessionNavigationTarget> = {}
  for (const [key, value] of Object.entries(target)) copy[key] = copyNavigationTarget(value)
  return Object.freeze(copy)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
