import type { Annotation, BookRecord, ReadingLocation } from '../../src/core/types'
import type {
  EbookSessionError,
  EbookSessionFlow,
  EbookSessionNavigationTarget,
  EbookSessionPort,
  EbookSessionSnapshot,
  EbookSessionTocItem,
  EbookSelectionInput,
} from './ebook-session-port'
import type { ReaderSettings } from './legacy-reader-port'
import { EbookSearchIndex, type EbookSearchOptions, type EbookSearchSnapshot } from '../../src/core/ebook-search-index'
// @ts-expect-error JavaScript compatibility text-range module has no declaration file yet.
import { rangeFromTextOffsets, createRangeAnchor, resolveRangeAnchor } from '../../src/text-range.js'
// @ts-expect-error JavaScript compatibility text-range module has no declaration file yet.
import { normalizeAnchorText } from '../../src/text-anchor.js'
// @ts-expect-error Foliate dependency has no declaration file.
import { Overlayer } from 'foliate-js/overlayer.js'
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
  let desiredFlow: EbookSessionFlow = 'paginated'
  let flowOperationToken = 0
  let acceptRelocations = false
  let viewRelocateListener: EventListener | null = null
  let scrollerRelocateListener: EventListener | null = null
  let flowQueue: Promise<void> = Promise.resolve()
  let searchIndex: EbookSearchIndex | null = null
  let activeAnnotations: Annotation[] = []
  let appliedAnnotations = new Map<string, Annotation>()
  let annotationQueue: Promise<void> = Promise.resolve()
  let pendingSelection: { root: HTMLElement, range: Range, index: number, text: string } | null = null
  let pendingAnnotationRepairs: Annotation[] = []

  async function open(record: BookRecord, settings: ReaderSettings): Promise<void> {
    const generation = dependencies.nextGeneration()
    activeGeneration = generation
    acceptRelocations = false
    flowQueue = Promise.resolve()
    currentSettings = { ...DEFAULT_SETTINGS, ...settings }
    requestDesiredFlow(settingFlow(currentSettings), true)
    let phase: EbookSessionError['code'] = 'render'
    try {
      await releaseResources()
      if (generation !== activeGeneration) return

      currentRecord = record
      activeAnnotations = (record.annotations ?? []).filter(item => item.kind === 'ebook')
      currentFlow = 'paginated'
      currentSnapshot = createLoadingSnapshot(record, currentSettings, generation)
      dependencies.onSnapshot(currentSnapshot)

      const view = dependencies.createView()
      currentView = view
      dependencies.host.append(view)
      viewRelocateListener = createRelocateListener('view', generation)
      view.addEventListener('relocate', viewRelocateListener)
      view.addEventListener('load', onViewLoad)
      view.addEventListener('create-overlay', onCreateOverlay)
      view.addEventListener('draw-annotation', onDrawAnnotation)

      phase = 'parse'
      await view.open(record.blob)
      if (generation !== activeGeneration || currentView !== view) return

      phase = 'render'
      applyPaginatedSettings(view, currentSettings)

      phase = 'restore'
      await restorePosition(view, record.progress)
      if (generation !== activeGeneration || currentView !== view) return

      const initialFlowTarget = view.lastLocation ?? record.progress ?? null
      while (desiredFlow === 'scrolled' && !currentScroller) {
        phase = 'render'
        await enterScrolledFlow(
          initialFlowTarget,
          generation,
          flowOperationToken,
        )
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
      await setAnnotations(activeAnnotations)
      for (const repaired of pendingAnnotationRepairs) dependencies.onAnnotationRepair?.(repaired, generation)
      pendingAnnotationRepairs = []
    } catch (cause) {
      if (generation !== activeGeneration) return
      const error = sessionError(phase, cause)
      acceptRelocations = false
      await releaseResources(false)
      if (generation === activeGeneration) dependencies.onError(error, generation)
    }
  }

  async function close(): Promise<void> {
    activeGeneration = dependencies.nextGeneration()
    acceptRelocations = false
    flowQueue = Promise.resolve()
    flowOperationToken += 1
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

  async function search(query: string, options: EbookSearchOptions = {}): Promise<EbookSearchSnapshot> {
    const view = currentView
    if (!view || currentSnapshot?.status !== 'ready') throw new Error('Ebook search is unavailable')
    searchIndex ??= createSearchIndex(view)
    return searchIndex.search(query, {
      ...options,
      currentSectionIndex: currentScroller?.currentLocation()?.index
        ?? view.lastLocation?.section?.current ?? 0,
    })
  }

  function captureSelection(doc: Document, index: number) {
    const selection = doc.defaultView?.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount || !doc.body) {
      pendingSelection = null
      return
    }
    const range = selection.getRangeAt(0).cloneRange()
    if (!doc.body.contains(range.commonAncestorContainer)) return
    const text = selection.toString().trim()
    if (text) pendingSelection = { root: doc.body, range, index, text }
  }

  function consumeSelection(): EbookSelectionInput | null {
    const selection = pendingSelection
    pendingSelection = null
    const view = currentView
    if (!selection || !view?.getCFI || currentSnapshot?.status !== 'ready') return null
    const locator = view.getCFI(selection.index, selection.range)
    if (typeof locator !== 'string' || !locator) return null
    const rangeAnchor = createRangeAnchor(selection.root, selection.range)
    currentScroller?.deselect?.()
    view.deselect?.()
    return {
      locator,
      section: selection.index,
      text: selection.text,
      ...(rangeAnchor ? { anchor: {
        version: 1 as const,
        kind: 'ebook' as const,
        section: selection.index,
        cfi: locator,
        textOffset: rangeAnchor.textOffset,
        quote: rangeAnchor.quote,
      } } : {}),
    }
  }

  async function setAnnotations(annotations: Annotation[]): Promise<void> {
    const requested = annotations.filter(item => item.kind === 'ebook')
    activeAnnotations = requested
    currentScroller?.setAnnotations?.(requested)
    const view = currentView
    const generation = activeGeneration
    const operation = annotationQueue.catch(() => {}).then(async () => {
      if (!view || view !== currentView || generation !== activeGeneration || currentSnapshot?.status !== 'ready') return
      const next = new Map(requested.filter(item => item.locator && item.anchorStatus !== 'unresolved')
        .map(item => [item.locator!, item]))
      const applied = new Map<string, Annotation>()
      for (const [locator, previous] of appliedAnnotations) {
        const current = next.get(locator)
        if (current && current.color === previous.color && current.note === previous.note) {
          applied.set(locator, current)
          continue
        }
        try { await view.deleteAnnotation?.({ value: locator }) }
        catch (error) { console.warn('Could not remove an ebook highlight.', error) }
        if (view !== currentView || generation !== activeGeneration) return
      }
      for (const [locator, annotation] of next) {
        if (applied.has(locator)) continue
        try {
          await view.addAnnotation?.({ value: locator, color: annotation.color, note: annotation.note })
          applied.set(locator, annotation)
        } catch (error) { console.warn('Could not display an ebook highlight.', error) }
        if (view !== currentView || generation !== activeGeneration) return
      }
      appliedAnnotations = applied
    })
    annotationQueue = operation
    await operation
  }

  function onViewLoad(event: Event) {
    const detail = (event as CustomEvent<{ doc: Document, index: number }>).detail
    const { doc, index } = detail ?? {}
    if (!doc || !Number.isInteger(index)) return
    const repairs: Annotation[] = []
    const next = activeAnnotations.map(annotation => {
      if (annotation.section !== index || annotation.anchor?.kind !== 'ebook' || annotation.anchorStatus === 'unresolved') return annotation
      let range: Range | null = null
      try {
        const resolved = currentView?.resolveNavigation?.(annotation.locator || '')
        if (resolved?.index === index) range = resolved.anchor?.(doc) ?? null
      } catch { /* A stale CFI is repaired from its quote below. */ }
      if (range && !range.collapsed && normalizeAnchorText(range.toString()).text === annotation.anchor.quote.normalizedExact) return annotation
      const fallback = doc.body ? resolveRangeAnchor(doc.body, annotation.anchor.quote, annotation.anchor.textOffset) as { range: Range, textOffset: number } | null : null
      if (fallback && currentView?.getCFI) {
        const locator = currentView.getCFI(index, fallback.range)
        if (typeof locator === 'string' && locator) {
          const repaired: Annotation = { ...annotation, locator, anchorStatus: 'resolved',
            anchor: { ...annotation.anchor, cfi: locator, textOffset: fallback.textOffset } }
          repairs.push(repaired)
          return repaired
        }
      }
      const unresolved: Annotation = { ...annotation, anchorStatus: 'unresolved' }
      repairs.push(unresolved)
      return unresolved
    })
    if (repairs.length) {
      activeAnnotations = next
      if (currentSnapshot?.status === 'ready') {
        for (const repaired of repairs) dependencies.onAnnotationRepair?.(repaired, activeGeneration)
        void setAnnotations(next).catch(console.error)
      } else pendingAnnotationRepairs.push(...repairs)
    }
    const capture = () => captureSelection(doc, index)
    doc.addEventListener('mouseup', capture)
    doc.addEventListener('selectionchange', capture)
  }

  function onCreateOverlay(event: Event) {
    const index = (event as CustomEvent<{ index: number }>).detail?.index
    if (!Number.isInteger(index)) return
    const view = currentView
    const generation = activeGeneration
    const operation = annotationQueue.catch(() => {}).then(async () => {
      if (!view || view !== currentView || generation !== activeGeneration) return
      const unique = new Map(activeAnnotations.filter(item => item.anchorStatus !== 'unresolved'
        && (item.section == null || item.section === index) && item.locator)
        .map(item => [item.locator!, item]))
      for (const [locator, annotation] of unique) {
        try { await view.addAnnotation?.({ value: locator, color: annotation.color, note: annotation.note }) }
        catch (error) { console.warn('Could not restore an ebook highlight.', error) }
        if (view !== currentView || generation !== activeGeneration) return
      }
    })
    annotationQueue = operation
    void operation.catch(console.error)
  }

  function onDrawAnnotation(event: Event) {
    const detail = (event as CustomEvent<{ draw: (func: unknown, options: { color: string }) => void, annotation: { color?: string } }>).detail
    detail?.draw(Overlayer.highlight, { color: detail.annotation.color || '#f4c95d' })
  }

  function createSearchIndex(view: EbookViewLike): EbookSearchIndex {
    const sections = (view.book.sections ?? []).flatMap((section, index) => {
      if (!section?.createDocument) return []
      let documentPromise: Promise<Document> | null = null
      const loadDocument = () => documentPromise ??= Promise.resolve(section.createDocument!())
      return [{
        index,
        label: displayEngineValue(view.getProgressOf?.(index)?.tocItem?.label) || `第 ${index + 1} 章`,
        loadText: async () => {
          const doc = await loadDocument()
          return doc.body?.textContent || doc.documentElement?.textContent || ''
        },
        createLocator: async (offset: number, length: number) => {
          const doc = await loadDocument()
          const root = doc.body || doc.documentElement
          const range = root ? rangeFromTextOffsets(root, offset, offset + length) as Range | null : null
          if (!range || !view.getCFI) throw new Error(`Unable to locate search result in section ${index}`)
          return view.getCFI(index, range)
        },
      }]
    })
    return new EbookSearchIndex(sections)
  }

  async function setFlow(flow: EbookSessionFlow): Promise<void> {
    const generation = activeGeneration
    const operationToken = requestDesiredFlow(flow)
    const operation = flowQueue.catch(() => {}).then(async () => {
      if (generation !== activeGeneration || !currentView) return
      if (operationToken !== flowOperationToken || flow !== desiredFlow) return
      if (flow === currentFlow) {
        currentSettings = { ...currentSettings, flow }
        return
      }
      try {
        if (flow === 'scrolled') {
          await enterScrolledFlow(currentView.lastLocation ?? null, generation, operationToken)
          if (isActiveFlowRequest('scrolled', generation, operationToken) && currentFlow === 'scrolled') {
            publishFlowSnapshot('scrolled', generation)
          }
        } else {
          await leaveScrolledFlow(generation)
        }
      } catch (cause) {
        if (isActiveFlowRequest(flow, generation, operationToken)) {
          const phase: EbookSessionError['code'] = flow === 'paginated' ? 'restore' : 'render'
          dependencies.onError(sessionError(phase, cause), generation)
        }
        throw cause
      }
    })
    flowQueue = operation
    return operation
  }

  async function applySettings(settings: ReaderSettings): Promise<void> {
    currentSettings = { ...DEFAULT_SETTINGS, ...settings }
    const flow = settingFlow(currentSettings)
    if (!currentView) {
      requestDesiredFlow(flow)
      return
    }
    applyPaginatedSettings(currentView, currentSettings)
    currentScroller?.setStyles(createBookStyles(currentSettings, true))
    await setFlow(flow)
  }

  async function flushProgress(): Promise<void> {
    await progressService.flush()
  }

  function destroy(): void {
    activeGeneration = dependencies.nextGeneration()
    const teardownGeneration = activeGeneration
    acceptRelocations = false
    flowQueue = Promise.resolve()
    flowOperationToken += 1
    const resources = takeResources()
    if (!resources.hadResources) return
    void progressService.flush().catch(cause => {
      if (teardownGeneration === activeGeneration) {
        dependencies.onError(sessionError('render', cause), teardownGeneration)
      }
    })
    destroyResources(resources)
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

  async function enterScrolledFlow(
    target: unknown,
    generation: number,
    operationToken: number,
  ): Promise<void> {
    const view = currentView
    if (!view || currentScroller || !isActiveFlowRequest('scrolled', generation, operationToken)) return
    acceptRelocations = false
    view.style.display = 'none'
    const scroller = dependencies.createScroller({
      host: dependencies.host,
      view,
      styles: createBookStyles(currentSettings, true),
      annotations: activeAnnotations,
      onSelection: captureSelection,
      onAnchorRepair: annotation => {
        if (generation === activeGeneration) dependencies.onAnnotationRepair?.(annotation, generation)
      },
    })
    const listener = createRelocateListener('scroller', generation)
    currentScroller = scroller
    scrollerRelocateListener = listener
    scroller.addEventListener('relocate', listener)
    try {
      await scroller.mount(target)
      if (!isActiveFlowRequest('scrolled', generation, operationToken) || currentScroller !== scroller) {
        if (currentScroller === scroller) {
          scroller.removeEventListener('relocate', listener)
          currentScroller = null
          if (scrollerRelocateListener === listener) scrollerRelocateListener = null
          scroller.destroy()
          if (generation === activeGeneration && currentView === view) {
            view.style.removeProperty('display')
            acceptRelocations = currentSnapshot?.status === 'ready'
          }
        }
        return
      }
      currentFlow = 'scrolled'
      acceptRelocations = currentSnapshot?.status === 'ready'
    } catch (cause) {
      if (currentScroller === scroller) {
        scroller.removeEventListener('relocate', listener)
        currentScroller = null
        if (scrollerRelocateListener === listener) scrollerRelocateListener = null
        scroller.destroy()
        view.style.removeProperty('display')
        acceptRelocations = currentSnapshot?.status === 'ready'
      }
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
    currentFlow = 'paginated'
    acceptRelocations = currentSnapshot?.status === 'ready'
    publishFlowSnapshot('paginated', generation, location)
    if (location?.cfi) await view.goTo(location.cfi)
    else if (typeof location?.fraction === 'number') await view.goToFraction(normalizeFraction(location.fraction))
  }

  async function releaseResources(flush = true): Promise<void> {
    const resources = takeResources()
    if (!resources.hadResources) return
    try {
      if (flush) await progressService.flush()
    } finally {
      destroyResources(resources)
    }
  }

  function takeResources() {
    const hadResources = hasResources()
    acceptRelocations = false
    searchIndex?.clear()
    searchIndex = null
    pendingSelection = null
    pendingAnnotationRepairs = []
    activeAnnotations = []
    appliedAnnotations = new Map()
    annotationQueue = Promise.resolve()
    detachListeners()
    const scroller = currentScroller
    const view = currentView
    currentScroller = null
    currentView = null
    currentRecord = null
    currentSnapshot = null
    return { hadResources, scroller, view }
  }

  function destroyResources(resources: {
    scroller: EbookScrollerLike | null
    view: EbookViewLike | null
  }) {
    resources.scroller?.destroy()
    resources.view?.close()
    resources.view?.remove()
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
    return snapshotAtLocation(snapshot, activeLocation())
  }

  function snapshotAtLocation(
    snapshot: EbookSessionSnapshot,
    location: EbookLocationLike | null,
  ): EbookSessionSnapshot {
    if (!location) return snapshot
    return {
      ...snapshot,
      chapter: displayEngineValue(location.tocItem?.label) || snapshot.chapter,
      progress: normalizeFraction(location.fraction ?? snapshot.progress),
    }
  }

  function publishFlowSnapshot(
    flow: EbookSessionFlow,
    generation: number,
    location: EbookLocationLike | null = activeLocation(),
  ) {
    if (generation !== activeGeneration) return
    currentFlow = flow
    currentSettings = { ...currentSettings, flow }
    if (!currentSnapshot) return
    currentSnapshot = snapshotAtLocation({ ...currentSnapshot, flow }, location)
    dependencies.onSnapshot(currentSnapshot)
  }

  function isActiveFlowRequest(
    flow: EbookSessionFlow,
    generation: number,
    operationToken: number,
  ) {
    return generation === activeGeneration
      && operationToken === flowOperationToken
      && flow === desiredFlow
  }

  function requestDesiredFlow(flow: EbookSessionFlow, forceNewOperation = false) {
    if (forceNewOperation || flow !== desiredFlow) flowOperationToken += 1
    desiredFlow = flow
    return flowOperationToken
  }

  return {
    open,
    close,
    goTo,
    navigate,
    search,
    consumeSelection,
    setAnnotations,
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
  const presentation = {
    format: {
      title: '不支持这个文件',
      detail: '请确认文件格式为 EPUB、MOBI 或 AZW3 后重试。',
    },
    parse: {
      title: '无法解析这本书',
      detail: '文件内容无法解析。请确认文件完整后重试。',
    },
    restore: {
      title: '无法恢复阅读位置',
      detail: '已保留这本书，请重新打开后从开头继续阅读。',
    },
    render: {
      title: '无法显示这本书',
      detail: '阅读视图无法建立。请重新打开书籍后重试。',
    },
  }[code]
  return { code, ...presentation, diagnostic: diagnosticFor(cause) }
}

function diagnosticFor(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  try {
    return String(cause)
  } catch {
    return 'Unknown ebook engine failure'
  }
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
