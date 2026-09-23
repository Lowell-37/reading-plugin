import type { BookRecord } from '../../src/core/types'
import type {
  PdfOutlineItem,
  PdfSessionError,
  PdfSessionPort,
  PdfSessionSnapshot,
} from './pdf-session-port'
import type { ReaderSettings } from './legacy-reader-port'
import type {
  PdfDocumentLike,
  PdfJsLike,
  PdfLoadingTaskLike,
  PdfObserverLike,
  PdfPageLike,
  PdfSessionDependencies,
} from './pdf-session-dependencies'

const DEFAULT_ZOOM = 1

/** Owns all live PDF.js and rendering resources for one WXT PDF reader session. */
export function createPdfJsSession(
  dependencies: PdfSessionDependencies,
): PdfSessionPort {
  const progressService = dependencies.createProgressService()
  let activeGeneration = 0
  let currentDocument: PdfDocumentLike | null = null
  let currentEngine: PdfJsLike | null = null
  let currentLoadingTask: PdfLoadingTaskLike | null = null
  let currentObserver: PdfObserverLike | null = null
  let currentRecord: BookRecord | null = null
  let currentSnapshot: PdfSessionSnapshot | null = null
  let currentPage = 1
  let currentZoom = DEFAULT_ZOOM
  let renderEpoch = 0
  let scrollListener: (() => void) | null = null
  let scrollFrame: number | null = null
  let settledScrollTop = 0
  const frames = new Set<number>()
  const pageCache = new Map<number, PdfPageLike>()
  const renderTasks = new Map<number, ReturnType<PdfPageLike['render']>>()

  async function open(record: BookRecord, _settings: ReaderSettings): Promise<void> {
    settleScroll(activeGeneration)
    const generation = dependencies.nextGeneration()
    activeGeneration = generation
    await releaseResources()
    if (!isActive(generation)) return

    currentRecord = record
    currentPage = 1
    currentZoom = DEFAULT_ZOOM
    currentSnapshot = loadingSnapshot(record, generation)
    publishSnapshot(generation)
    let phase: PdfSessionError['code'] = 'parse'
    try {
      const engine = await dependencies.loadPdfJs()
      if (!isActive(generation)) return
      currentEngine = engine
      if (engine.GlobalWorkerOptions) engine.GlobalWorkerOptions.workerSrc = workerUrl(dependencies.baseUrl)
      const data = new Uint8Array(await record.blob.arrayBuffer())
      if (!isActive(generation)) return
      const loadingTask = engine.getDocument({
        data,
        cMapUrl: `${dependencies.baseUrl}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${dependencies.baseUrl}standard_fonts/`,
        wasmUrl: `${dependencies.baseUrl}wasm/`,
      })
      currentLoadingTask = loadingTask
      const document = await loadingTask.promise
      if (!isActive(generation) || currentLoadingTask !== loadingTask) {
        await destroyDocument(document)
        return
      }
      currentLoadingTask = null
      currentDocument = document

      const [metadata, sourceOutline] = await Promise.all([
        document.getMetadata().catch(() => null),
        document.getOutline().catch(() => null),
      ])
      if (!isActive(generation) || currentDocument !== document) return
      const outline = await convertOutline(document, sourceOutline ?? [])
      if (!isActive(generation) || currentDocument !== document) return

      buildPageWrappers(document.numPages)
      connectObserver(generation)
      connectScroll(generation)
      currentSnapshot = {
        status: 'loading',
        title: displayText(metadata?.info?.Title) || displayText(record.metadata?.title) || titleFromName(record.name),
        outline,
        page: 1,
        pageCount: document.numPages,
        zoom: currentZoom,
        progress: 0,
        error: null,
        generation,
      }

      phase = 'restore'
      const restoredPage = record.progress?.kind === 'pdf' ? record.progress.page : 1
      const restored = await goToPage(restoredPage, generation, 'restore')
      if (!restored || !isActive(generation) || currentDocument !== document) return
      currentSnapshot = { ...currentSnapshot, status: 'ready' }
      publishSnapshot(generation)
    } catch (cause) {
      if (!isActive(generation)) return
      await releaseResources(false)
      if (isActive(generation)) dependencies.onError(sessionError(phase, cause), generation)
    }
  }

  async function close(): Promise<void> {
    settleScroll(activeGeneration)
    activeGeneration = dependencies.nextGeneration()
    await releaseResources()
  }

  async function goTo(page: number): Promise<void> {
    await goToPage(page, activeGeneration, 'render')
  }

  async function navigate(direction: -1 | 1): Promise<void> {
    settleScroll(activeGeneration)
    await goToPage(currentPage + direction, activeGeneration, 'render')
  }

  async function setZoom(zoom: number): Promise<void> {
    if (!currentDocument || !currentSnapshot) return
    settleScroll(activeGeneration)
    currentZoom = normalizeZoom(zoom)
    clearRenderedPages()
    currentSnapshot = { ...currentSnapshot, zoom: currentZoom }
    publishSnapshot(activeGeneration)
    queueRenderAround(currentPage, activeGeneration)
  }

  async function flushProgress(): Promise<void> {
    settleScroll(activeGeneration)
    await progressService.flush()
  }

  function destroy(): void {
    activeGeneration = dependencies.nextGeneration()
    progressService.cancel()
    const resources = takeResources()
    void destroyResources(resources)
  }

  async function goToPage(requestedPage: number, generation: number, phase: PdfSessionError['code']): Promise<boolean> {
    const document = currentDocument
    if (!document || !currentSnapshot || !isActive(generation)) return false
    try {
      currentPage = clampPage(requestedPage, document.numPages)
      const wrapper = pageElement(currentPage)
      if (wrapper) scrollToPage(wrapper)
      // Native scroll events arrive after scrollTo. Ignore this position, but not a
      // subsequent user scroll; page projection never calls scrollTo itself.
      settledScrollTop = dependencies.host.viewport.scrollTop
      projectPage(currentPage, generation)
      return true
    } catch (cause) {
      if (isActive(generation)) dependencies.onError(sessionError(phase, cause), generation)
      return false
    }
  }

  function projectPage(page: number, generation: number) {
    if (!currentDocument || !currentSnapshot || !currentRecord || !isActive(generation)) return
    currentPage = page
    const progress = pageProgress(page, currentDocument.numPages)
    currentSnapshot = { ...currentSnapshot, page, progress }
    publishSnapshot(generation)
    progressService.schedule(currentRecord.id, { kind: 'pdf', page, fraction: progress })
    queueRenderAround(page, generation)
  }

  function connectScroll(generation: number) {
    const viewport = dependencies.host.viewport
    settledScrollTop = viewport.scrollTop
    const listener = () => {
      if (!isActive(generation) || scrollListener !== listener || scrollFrame !== null) return
      scrollFrame = dependencies.requestFrame(() => {
        if (!isActive(generation) || scrollListener !== listener) return
        scrollFrame = null
        settleScroll(generation)
      })
    }
    scrollListener = listener
    viewport.addEventListener('scroll', listener, { passive: true })
  }

  function settleScroll(generation: number) {
    const viewport = dependencies.host.viewport
    if (!isActive(generation) || !currentDocument || !currentSnapshot
      || viewport.scrollTop === settledScrollTop || viewport.clientHeight <= 0) return
    settledScrollTop = viewport.scrollTop
    const bounds = viewport.getBoundingClientRect()
    // The first page crossing a reading line near the top wins (not the lazy
    // observer's expanded root). In a page gap choose the following visible page.
    const readingLine = bounds.top + Math.min(100, viewport.clientHeight / 4)
    for (const wrapper of dependencies.host.pages.querySelectorAll<HTMLElement>('.pdf-page')) {
      const rect = wrapper.getBoundingClientRect()
      if (rect.height > 0 && rect.bottom > readingLine && rect.top < bounds.bottom) {
        const page = Number(wrapper.dataset.page)
        if (page !== currentPage) projectPage(page, generation)
        return
      }
    }
  }

  function buildPageWrappers(pageCount: number) {
    const ownerDocument = dependencies.host.pages.ownerDocument
    const fragment = ownerDocument.createDocumentFragment()
    for (let page = 1; page <= pageCount; page += 1) {
      const wrapper = ownerDocument.createElement('section')
      wrapper.className = 'pdf-page'
      wrapper.dataset.page = String(page)
      wrapper.dataset.state = 'idle'
      wrapper.textContent = `第 ${page} 页`
      fragment.append(wrapper)
    }
    dependencies.host.pages.replaceChildren(fragment)
  }

  function connectObserver(generation: number) {
    currentObserver?.disconnect()
    const observer = dependencies.createObserver(entries => {
      if (!isActive(generation) || currentObserver !== observer) return
      for (const entry of entries) {
        if (entry.isIntersecting) queueRender(Number((entry.target as HTMLElement).dataset.page), generation)
      }
    })
    currentObserver = observer
    dependencies.host.pages.querySelectorAll('.pdf-page').forEach(wrapper => observer.observe(wrapper))
  }

  function queueRenderAround(page: number, generation: number) {
    queueRender(page, generation)
    queueRender(page - 1, generation)
    queueRender(page + 1, generation)
  }

  function queueRender(page: number, generation: number) {
    const document = currentDocument
    if (!document || page < 1 || page > document.numPages || !isActive(generation)) return
    if (pageElement(page)?.dataset.state !== 'idle') return
    const rendition = renderEpoch
    const frame = dependencies.requestFrame(() => {
      frames.delete(frame)
      if (rendition !== renderEpoch) return
      void renderPage(page, generation, rendition)
    })
    frames.add(frame)
  }

  async function renderPage(pageNumber: number, generation: number, rendition: number): Promise<void> {
    const document = currentDocument
    const engine = currentEngine
    const wrapper = pageElement(pageNumber)
    let renderTask: ReturnType<PdfPageLike['render']> | null = null
    if (!document || !engine || !wrapper || !isActive(generation) || wrapper.dataset.state !== 'idle') return
    wrapper.dataset.state = 'rendering'
    try {
      const page = pageCache.get(pageNumber) ?? await document.getPage(pageNumber)
      if (!isActive(generation) || rendition !== renderEpoch || currentDocument !== document || pageElement(pageNumber) !== wrapper) return
      pageCache.set(pageNumber, page)
      const baseViewport = page.getViewport({ scale: 1 })
      const cssScale = Math.max(320, Math.min(900, dependencies.host.viewport.clientWidth - 64)) / baseViewport.width * currentZoom
      const cssViewport = page.getViewport({ scale: cssScale })
      const renderViewport = page.getViewport({ scale: cssScale * Math.min(Math.max(dependencies.pixelRatio(), 1), 2) })
      const ownerDocument = wrapper.ownerDocument
      const canvas = ownerDocument.createElement('canvas')
      canvas.width = Math.floor(renderViewport.width)
      canvas.height = Math.floor(renderViewport.height)
      canvas.style.width = `${Math.floor(cssViewport.width)}px`
      canvas.style.height = `${Math.floor(cssViewport.height)}px`
      wrapper.style.width = `${Math.floor(cssViewport.width)}px`
      wrapper.style.height = `${Math.floor(cssViewport.height)}px`
      wrapper.style.aspectRatio = `${baseViewport.width}/${baseViewport.height}`
      const textLayer = ownerDocument.createElement('div')
      textLayer.className = 'textLayer'
      wrapper.replaceChildren(canvas, textLayer)
      const label = ownerDocument.createElement('span')
      label.className = 'pdf-page-number'
      label.textContent = String(pageNumber)
      wrapper.append(label)
      const content = await page.getTextContent()
      if (!isCurrentRender(pageNumber, generation, rendition, document, wrapper, renderTask)) return
      renderTask = page.render({
        canvasContext: canvas.getContext('2d', { alpha: false }),
        viewport: renderViewport,
      })
      renderTasks.set(pageNumber, renderTask)
      await Promise.all([
        renderTask.promise,
        new engine.TextLayer({ textContentSource: content, container: textLayer, viewport: cssViewport }).render(),
      ])
      if (!isCurrentRender(pageNumber, generation, rendition, document, wrapper, renderTask)) return
      wrapper.dataset.state = 'rendered'
      renderTasks.delete(pageNumber)
    } catch (cause) {
      if (!isCurrentRender(pageNumber, generation, rendition, document, wrapper, renderTask)) return
      renderTasks.delete(pageNumber)
      wrapper.dataset.state = 'error'
      wrapper.textContent = `第 ${pageNumber} 页渲染失败`
      dependencies.onError(sessionError('render', cause), generation)
    }
  }

  function clearRenderedPages() {
    renderEpoch += 1
    for (const wrapper of dependencies.host.pages.querySelectorAll<HTMLElement>('.pdf-page')) {
      wrapper.dataset.state = 'idle'
      wrapper.replaceChildren(`第 ${wrapper.dataset.page} 页`)
    }
    for (const task of renderTasks.values()) task.cancel?.()
    renderTasks.clear()
  }

  function isCurrentRender(
    pageNumber: number,
    generation: number,
    rendition: number,
    document: PdfDocumentLike,
    wrapper: HTMLElement,
    renderTask: ReturnType<PdfPageLike['render']> | null,
  ) {
    return isActive(generation)
      && rendition === renderEpoch
      && currentDocument === document
      && pageElement(pageNumber) === wrapper
      && (renderTask === null || renderTasks.get(pageNumber) === renderTask)
  }

  async function releaseResources(flush = true): Promise<void> {
    const resources = takeResources()
    try {
      if (flush && resources.hadActiveSession) await progressService.flush()
    } finally {
      await destroyResources(resources)
    }
  }

  function takeResources() {
    if (scrollListener) dependencies.host.viewport.removeEventListener('scroll', scrollListener)
    scrollListener = null
    if (scrollFrame !== null) dependencies.cancelFrame(scrollFrame)
    scrollFrame = null
    for (const frame of frames) dependencies.cancelFrame(frame)
    frames.clear()
    currentObserver?.disconnect()
    const resources = {
      hadActiveSession: currentRecord !== null || currentDocument !== null || currentLoadingTask !== null,
      document: currentDocument,
      loadingTask: currentLoadingTask,
      renderTasks: [...renderTasks.values()],
    }
    currentDocument = null
    currentEngine = null
    currentLoadingTask = null
    currentObserver = null
    currentRecord = null
    currentSnapshot = null
    pageCache.clear()
    renderTasks.clear()
    dependencies.host.pages.replaceChildren()
    return resources
  }

  function publishSnapshot(generation: number) {
    if (!isActive(generation) || !currentSnapshot) return
    dependencies.onSnapshot({
      ...currentSnapshot,
      outline: copyOutline(currentSnapshot.outline),
      error: currentSnapshot.error ? { ...currentSnapshot.error } : null,
    })
  }

  async function destroyResources(resources: {
    document: PdfDocumentLike | null
    loadingTask: PdfLoadingTaskLike | null
    renderTasks: Array<{ cancel?(): void }>
  }) {
    for (const task of resources.renderTasks) task.cancel?.()
    await Promise.resolve(resources.loadingTask?.destroy?.())
    await destroyDocument(resources.document)
  }

  function pageElement(page: number): HTMLElement | null {
    return dependencies.host.pages.querySelector<HTMLElement>(`.pdf-page[data-page="${page}"]`)
  }

  function scrollToPage(wrapper: HTMLElement) {
    dependencies.host.viewport.scrollTo({ top: wrapper.offsetTop, behavior: 'auto' })
  }

  return { open, close, goTo, navigate, setZoom, flushProgress, destroy }

  function isActive(generation: number) {
    return generation === activeGeneration
  }
}

async function convertOutline(document: PdfDocumentLike, items: import('./pdf-session-dependencies').PdfOutlineSource[]): Promise<PdfOutlineItem[]> {
  return await Promise.all(items.map(async item => ({
    label: displayText(item.title) || '未命名书签',
    page: await outlinePage(document, item.dest),
    ...(item.items?.length ? { children: await convertOutline(document, item.items) } : {}),
  })))
}

async function outlinePage(document: PdfDocumentLike, destination: unknown): Promise<number> {
  try {
    const resolved = typeof destination === 'string' ? await document.getDestination(destination) : destination
    const reference = Array.isArray(resolved) ? resolved[0] : null
    if (typeof reference === 'number') return reference + 1
    if (reference && typeof reference === 'object') return await document.getPageIndex(reference) + 1
  } catch {}
  return 1
}

function loadingSnapshot(record: BookRecord, generation: number): PdfSessionSnapshot {
  return {
    status: 'loading',
    title: displayText(record.metadata?.title) || titleFromName(record.name),
    outline: [],
    page: 1,
    pageCount: 0,
    zoom: DEFAULT_ZOOM,
    progress: 0,
    error: null,
    generation,
  }
}

function copyOutline(items: PdfOutlineItem[]): PdfOutlineItem[] {
  return items.map(item => ({
    label: item.label,
    page: item.page,
    ...(item.children ? { children: copyOutline(item.children) } : {}),
  }))
}

function pageProgress(page: number, pageCount: number) {
  return pageCount <= 1 ? 1 : (page - 1) / (pageCount - 1)
}

function clampPage(page: number, pageCount: number) {
  return Math.max(1, Math.min(pageCount, Math.round(Number(page) || 1)))
}

function normalizeZoom(zoom: number) {
  return Math.max(0.6, Math.min(2.5, Math.round(Number(zoom) * 10) / 10))
}

function displayText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function titleFromName(name: string) {
  return name.replace(/\.pdf$/i, '') || '未命名 PDF'
}

function workerUrl(baseUrl: string) {
  return `${baseUrl}build/pdf.worker.min.mjs`
}

function sessionError(code: PdfSessionError['code'], cause: unknown): PdfSessionError {
  if (code === 'parse' && isPasswordError(cause)) code = 'password'
  const safeCopy = {
    password: { title: 'PDF 需要密码', detail: '请输入正确密码后重试。' },
    parse: { title: '无法解析 PDF', detail: '文件内容无法解析。请确认文件完整后重试。' },
    render: { title: '无法显示 PDF', detail: 'PDF 页面无法渲染。请重新打开文件后重试。' },
    restore: { title: '无法恢复阅读位置', detail: '已保留 PDF，请重新打开后从第一页继续阅读。' },
    cancelled: { title: '已取消打开 PDF', detail: '请重新选择文件后重试。' },
  }[code]
  return { code, ...safeCopy, diagnostic: diagnosticFor(cause) }
}

function isPasswordError(cause: unknown) {
  return Boolean(cause && typeof cause === 'object' && 'name' in cause && cause.name === 'PasswordException')
}

function diagnosticFor(cause: unknown) {
  if (cause instanceof Error) return cause.message
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message
  return String(cause || 'unknown PDF error')
}

async function destroyDocument(document: PdfDocumentLike | null) {
  await Promise.resolve(document?.destroy?.())
}
