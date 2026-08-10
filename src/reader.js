import '../node_modules/foliate-js/view.js'
import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs'
import { Overlayer } from '../node_modules/foliate-js/overlayer.js'
import {
  createAnnotation,
  excerpt,
  filterAnnotations,
  findTextMatches,
  normalizeAnnotations,
  sortAnnotations,
  updateAnnotation,
} from './annotations.js'
import {
  annotationExportFileName,
  createAnnotationExport,
  serializeAnnotationsJson,
  serializeAnnotationsMarkdown,
} from './annotation-export.js'
import { annotationImportMatchesBook, mergeAnnotationImports, parseAnnotationImport } from './annotation-import.js'
import { recoverTextAnchor } from './anchor-recovery.js'
import { buildAiMessages, CHAPTER_AI_ACTIONS, getAiPermissionOrigin, SELECTION_AI_ACTIONS, streamAiCompletion } from './ai.js'
import { bookRepository } from './book-repository.js'
import { ContinuousEbookScroller } from './continuous-ebook.js'
import { initializeEbookPosition } from './ebook-navigation.js'
import { EbookSearchIndex } from './ebook-search-index.js'
import { detectFormat, displayValue, formatBytes } from './formats.js'
import { backupFileName, createLibraryBackup, parseLibraryBackup } from './library-backup.js'
import { describeOpenError } from './open-errors.js'
import { ProgressService } from './progress-service.js'
import { createEbookReaderAdapter, createPdfReaderAdapter } from './reader-adapter.js'
import { createSearchContext } from './search-context.js'
import { loadSettings, saveSettings } from './storage.js'
import { normalizeAnchorText } from './text-anchor.js'
import { createRangeAnchor, rangeFromTextOffsets, resolveRangeAnchor } from './text-range.js'

const $ = selector => document.querySelector(selector)
const elements = {
  fileInput: $('#file-input'),
  openButton: $('#open-button'),
  heroOpenButton: $('#hero-open-button'),
  homeButton: $('#home-button'),
  headerToggle: $('#header-toggle'),
  welcomeView: $('#welcome-view'),
  readerView: $('#reader-view'),
  dropZone: $('#drop-zone'),
  librarySection: $('#library-section'),
  bookGrid: $('#book-grid'),
  backupLibrary: $('#backup-library'),
  restoreLibrary: $('#restore-library'),
  backupFileInput: $('#backup-file-input'),
  backupStatus: $('#backup-status'),
  sidebar: $('#sidebar'),
  sidebarButton: $('#sidebar-button'),
  scrim: $('#scrim'),
  settingsPanel: $('#settings-panel'),
  settingsButton: $('#settings-button'),
  toolsButton: $('#tools-button'),
  toolsPanel: $('#tools-panel'),
  closeTools: $('#close-tools'),
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  searchStatus: $('#search-status'),
  searchResults: $('#search-results'),
  highlightSelection: $('#highlight-selection'),
  noteSelection: $('#note-selection'),
  annotationCount: $('#annotation-count'),
  annotationFilterQuery: $('#annotation-filter-query'),
  annotationFilterType: $('#annotation-filter-type'),
  annotationSort: $('#annotation-sort'),
  annotationSelectAll: $('#annotation-select-all'),
  annotationDeleteSelected: $('#annotation-delete-selected'),
  importAnnotationsJson: $('#import-annotations-json'),
  annotationImportInput: $('#annotation-import-input'),
  exportAnnotationsMarkdown: $('#export-annotations-markdown'),
  exportAnnotationsJson: $('#export-annotations-json'),
  annotationList: $('#annotation-list'),
  aiSelectionPreview: $('#ai-selection-preview'),
  aiSettingsToggle: $('#ai-settings-toggle'),
  aiSettings: $('#ai-settings'),
  aiEndpoint: $('#ai-endpoint'),
  aiModel: $('#ai-model'),
  aiApiKey: $('#ai-api-key'),
  saveAiSettings: $('#save-ai-settings'),
  aiResult: $('#ai-result'),
  aiResultTitle: $('#ai-result-title'),
  aiResultStatus: $('#ai-result-status'),
  aiResultContent: $('#ai-result-content'),
  aiStop: $('#ai-stop'),
  aiActionButtons: [...document.querySelectorAll('[data-ai-scope][data-ai-action]')],
  selectionAiMenu: $('#selection-ai-menu'),
  closeSelectionAiMenu: $('#close-selection-ai-menu'),
  closeSettings: $('#close-settings'),
  readerStage: $('#reader-stage'),
  ebookHost: $('#ebook-host'),
  pdfViewport: $('#pdf-viewport'),
  pdfPages: $('#pdf-pages'),
  loadingView: $('#loading-view'),
  loadingSpinner: $('#loading-spinner'),
  loadingTitle: $('#loading-title'),
  loadingDetail: $('#loading-detail'),
  loadingActions: $('#loading-actions'),
  loadingLibraryButton: $('#loading-library-button'),
  loadingRetryButton: $('#loading-retry-button'),
  headerTitle: $('#header-title'),
  sidebarTitle: $('#sidebar-title'),
  sidebarAuthor: $('#sidebar-author'),
  sidebarFormat: $('#sidebar-format'),
  sidebarCover: $('#sidebar-cover'),
  coverLetter: $('#cover-letter'),
  toc: $('#toc'),
  tocCount: $('#toc-count'),
  prevButton: $('#prev-button'),
  nextButton: $('#next-button'),
  chapterLabel: $('#chapter-label'),
  progressSlider: $('#progress-slider'),
  progressLabel: $('#progress-label'),
  toast: $('#toast'),
  fontSelect: $('#font-select'),
  fontSize: $('#font-size'),
  fontSizeValue: $('#font-size-value'),
  lineHeight: $('#line-height'),
  lineHeightValue: $('#line-height-value'),
  pageWidth: $('#page-width'),
  pageWidthValue: $('#page-width-value'),
  panelTip: $('#panel-tip'),
  pdfToolbar: $('#pdf-toolbar'),
  pdfZoomOut: $('#pdf-zoom-out'),
  pdfZoomIn: $('#pdf-zoom-in'),
  pdfZoomLabel: $('#pdf-zoom-label'),
  pdfFitWidth: $('#pdf-fit-width'),
  pdfPageJump: $('#pdf-page-jump'),
  pdfPageInput: $('#pdf-page-input'),
  pdfPageTotal: $('#pdf-page-total'),
}

const workerUrl = globalThis.chrome?.runtime?.getURL
  ? chrome.runtime.getURL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
  : new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

let settings = loadSettings()
let currentRecord = null
let currentFormat = null
let ebookView = null
let continuousEbook = null
let ebookSearchIndex = null
let pdfDocument = null
let pdfLoadingTask = null
let pdfObserver = null
let pdfScrollFrame = null
let currentPdfPage = 1
let pdfZoom = 1
let pdfSearchQuery = ''
let pdfTextCache = new Map()
let pendingSelection = null
let annotations = []
let annotationFilterQuery = ''
let annotationFilterType = 'all'
let annotationSort = 'newest'
let annotationRepairSave = null
const selectedAnnotationIds = new Set()
let searchAbortController = null
let aiAbortController = null
let readerAdapter = null
let coverObjectUrl = null
let libraryObjectUrls = []
const tocButtons = new Map()
const progressService = new ProgressService(bookRepository)

function showToast(message, type = '') {
  elements.toast.textContent = message
  elements.toast.className = `toast show ${type}`
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => { elements.toast.className = 'toast' }, 3200)
}

function setLoading(detail = '解析内容与目录…') {
  elements.loadingView.dataset.state = 'loading'
  elements.loadingTitle.textContent = '正在打开书籍'
  elements.loadingDetail.textContent = detail
  elements.loadingActions.hidden = true
  elements.loadingView.hidden = false
}

function showOpenError(description) {
  document.body.classList.remove('pdf-mode')
  elements.loadingView.dataset.state = 'error'
  elements.loadingTitle.textContent = description.code === 'unsupported' ? '不支持这个文件' : '无法打开这本书'
  elements.loadingDetail.textContent = description.message
  elements.loadingActions.hidden = false
  elements.loadingView.hidden = false
}

function hideLoading() {
  elements.loadingView.hidden = true
}

function openPicker() {
  elements.fileInput.value = ''
  elements.fileInput.click()
}

function closePanels() {
  elements.sidebar.classList.remove('open')
  elements.settingsPanel.classList.remove('open')
  elements.toolsPanel.classList.remove('open')
  elements.scrim.classList.remove('show')
}

function openPanel(panel) {
  closePanels()
  panel.classList.add('open')
  elements.scrim.classList.add('show')
}

function showReader() {
  document.body.classList.add('is-reading')
  setHeaderCollapsed(Boolean(settings.headerCollapsed), false)
  elements.welcomeView.hidden = true
  elements.readerView.hidden = false
}

async function showLibrary() {
  closeReader()
  document.body.classList.remove('is-reading', 'pdf-mode', 'header-collapsed')
  elements.readerView.hidden = true
  elements.welcomeView.hidden = false
  document.title = '静读'
  await renderLibrary()
}

function setHeaderCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('header-collapsed', collapsed)
  elements.headerToggle.ariaExpanded = String(!collapsed)
  elements.headerToggle.ariaLabel = collapsed ? '展开顶部栏' : '收起顶部栏'
  elements.headerToggle.title = elements.headerToggle.ariaLabel
  if (!persist) return
  settings.headerCollapsed = collapsed
  saveSettings(settings)
}
function closeReader() {
  progressService.flush().catch(console.error)
  readerAdapter?.destroy?.()
  readerAdapter = null
  closePanels()
  continuousEbook?.destroy()
  continuousEbook = null
  searchAbortController?.abort()
  searchAbortController = null
  ebookSearchIndex?.clear()
  ebookSearchIndex = null
  ebookView?.close?.()
  ebookView?.remove()
  ebookView = null
  pdfObserver?.disconnect()
  pdfObserver = null
  pdfLoadingTask?.destroy?.()
  pdfLoadingTask = null
  pdfDocument?.destroy?.()
  pdfDocument = null
  pdfTextCache.clear()
  pdfSearchQuery = ''
  pendingSelection = null
  aiAbortController?.abort()
  aiAbortController = null
  annotations = []
  elements.selectionAiMenu.hidden = true
  elements.aiResult.hidden = true
  elements.aiResultContent.textContent = ''
  elements.searchResults.replaceChildren()
  elements.searchStatus.textContent = '输入关键词搜索整本书'
  elements.pdfToolbar.hidden = true
  elements.pdfPageJump.hidden = true
  elements.ebookHost.replaceChildren()
  elements.pdfPages.replaceChildren()
  if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl)
  coverObjectUrl = null
  tocButtons.clear()
  currentRecord = null
  currentFormat = null
}

function applySettingsToControls() {
  document.documentElement.dataset.theme = settings.theme
  elements.fontSelect.value = settings.font
  elements.fontSize.value = settings.fontSize
  elements.fontSizeValue.value = settings.fontSize
  elements.lineHeight.value = settings.lineHeight
  elements.lineHeightValue.value = Number(settings.lineHeight).toFixed(2)
  elements.pageWidth.value = settings.pageWidth
  elements.pageWidthValue.value = settings.pageWidth
  elements.aiEndpoint.value = settings.aiEndpoint || 'https://api.openai.com/v1'
  elements.aiModel.value = settings.aiModel || ''
  elements.aiApiKey.value = settings.aiApiKey || ''
  document.querySelectorAll('[data-flow]').forEach(button => button.classList.toggle('active', button.dataset.flow === settings.flow))
  document.querySelectorAll('[data-theme]').forEach(button => button.classList.toggle('active', button.dataset.theme === settings.theme))
}

function getThemeColors() {
  return {
    paper: { background: '#f4f0e8', text: '#29251f', link: '#9b4932' },
    light: { background: '#ffffff', text: '#202124', link: '#3f6751' },
    sepia: { background: '#e9ddc4', text: '#3a3023', link: '#8c4e2d' },
    dark: { background: '#1e201d', text: '#e5e2d8', link: '#e19a7f' },
  }[settings.theme]
}

function getBookStyles() {
  const colors = getThemeColors()
  const fontFamily = {
    serif: 'ui-serif, "Noto Serif SC", "Songti SC", STSong, Georgia, serif',
    sans: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  }[settings.font]
  return `
    :root { color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'}; }
    html, body { background: ${colors.background} !important; color: ${colors.text} !important; }
    body { font-family: ${fontFamily} !important; font-size: ${settings.fontSize}px !important; }
    p, li, blockquote, dd { line-height: ${settings.lineHeight} !important; text-align: justify; hanging-punctuation: allow-end last; widows: 2; orphans: 2; }
    a:link, a:visited { color: ${colors.link}; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
  `
}

function getContinuousBookStyles() {
  return `${getBookStyles()}
    body { width:min(calc(100% - 48px), ${settings.pageWidth}px) !important; max-width:${settings.pageWidth}px !important; }
  `
}

function applyReaderSettings() {
  applySettingsToControls()
  saveSettings(settings)
  if (!ebookView?.renderer) return
  ebookView.renderer.setAttribute('flow', 'paginated')
  ebookView.renderer.setAttribute('animated', '')
  ebookView.renderer.setAttribute('margin', '64px')
  ebookView.renderer.setAttribute('gap', '7%')
  ebookView.renderer.setAttribute('max-inline-size', `${settings.pageWidth}px`)
  ebookView.renderer.setAttribute('max-column-count', '2')
  ebookView.renderer.setStyles?.(getBookStyles())
  continuousEbook?.setStyles(getContinuousBookStyles())
}

function handleEbookRelocate(detail) {
  const chapter = displayValue(detail.tocItem?.label) || '正文'
  updateProgress(detail.fraction, chapter)
  if (detail.tocItem?.href) markCurrentToc(detail.tocItem.href)
  scheduleProgressSave({ kind: 'ebook', cfi: detail.cfi || null, fraction: detail.fraction })
}

async function navigateEbookTo(target) {
  if (continuousEbook) return continuousEbook.goTo(target)
  return ebookView?.goTo(target)
}

async function setEbookFlow(flow, target = null) {
  if (!ebookView) return
  if (flow === 'scrolled') {
    if (continuousEbook) return
    ebookView.style.display = 'none'
    elements.panelTip.textContent = '滚轮连续阅读，章节会自然衔接'
    continuousEbook = new ContinuousEbookScroller({
      host: elements.ebookHost,
      view: ebookView,
      styles: getContinuousBookStyles(),
      annotations,
      onSelection: captureEbookSelection,
      onExternalLink: href => {
        if (confirm('这本书想要打开一个外部链接，是否继续？')) globalThis.open(href, '_blank')
      },
      onAnnotation: annotation => {
        if (annotation?.note) showToast(annotation.note)
      },
      onAnchorRepair: scheduleAnnotationRepairSave,
    })
    continuousEbook.addEventListener('relocate', ({ detail }) => handleEbookRelocate(detail))
    try {
      await continuousEbook.mount(target || ebookView.lastLocation)
    } catch (error) {
      continuousEbook.destroy()
      continuousEbook = null
      ebookView.style.removeProperty('display')
      elements.panelTip.textContent = '方向键翻页，Esc 收起面板'
      throw error
    }
    return
  }

  const location = continuousEbook?.currentLocation()
  continuousEbook?.destroy()
  continuousEbook = null
  ebookView.style.removeProperty('display')
  elements.panelTip.textContent = '方向键翻页，Esc 收起面板'
  if (location?.cfi) await ebookView.goTo(location.cfi)
  else if (typeof location?.fraction === 'number') await ebookView.goToFraction(location.fraction)
}

function scheduleProgressSave(progress) {
  progressService.schedule(currentRecord?.id, progress)
}

function updateProgress(fraction, chapter = '') {
  const safeFraction = Math.max(0, Math.min(1, Number(fraction) || 0))
  elements.progressSlider.value = safeFraction
  elements.progressLabel.textContent = `${Math.round(safeFraction * 100)}%`
  if (chapter) elements.chapterLabel.textContent = chapter
}

function setCover(cover, title) {
  if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl)
  coverObjectUrl = null
  elements.sidebarCover.querySelector('img')?.remove()
  elements.coverLetter.hidden = false
  elements.coverLetter.textContent = (title || '静').trim().slice(0, 1)
  if (!cover) return
  coverObjectUrl = URL.createObjectURL(cover)
  const image = new Image()
  image.src = coverObjectUrl
  image.alt = `${title}封面`
  elements.sidebarCover.prepend(image)
  elements.coverLetter.hidden = true
}

async function setMetadata({ title, author, cover }) {
  const resolvedTitle = displayValue(title) || currentRecord?.name?.replace(/\.[^.]+$/, '') || '未命名书籍'
  const resolvedAuthor = displayValue(author) || '未知作者'
  elements.headerTitle.textContent = resolvedTitle
  elements.sidebarTitle.textContent = resolvedTitle
  elements.sidebarAuthor.textContent = resolvedAuthor
  elements.sidebarFormat.textContent = currentFormat.toUpperCase()
  elements.coverLetter.textContent = resolvedTitle.slice(0, 1)
  document.title = `${resolvedTitle} · 静读`
  setCover(cover, resolvedTitle)
  if (currentRecord?.id) {
    currentRecord = { ...currentRecord, metadata: { title: resolvedTitle, author: resolvedAuthor }, cover }
    await bookRepository.update(currentRecord.id, { metadata: currentRecord.metadata, cover }).catch(console.error)
  }
}

function renderToc(items = [], onSelect) {
  elements.toc.replaceChildren()
  tocButtons.clear()
  let count = 0
  const buildList = list => {
    const ul = document.createElement('ul')
    for (const item of list || []) {
      count += 1
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = displayValue(item.label) || `章节 ${count}`
      button.addEventListener('click', () => { onSelect(item); closePanels() })
      li.append(button)
      if (item.href != null) tocButtons.set(String(item.href), button)
      if (item.subitems?.length) li.append(buildList(item.subitems))
      ul.append(li)
    }
    return ul
  }
  if (!items?.length) {
    const empty = document.createElement('p')
    empty.className = 'toc-empty'
    empty.textContent = '这本书没有提供目录'
    elements.toc.append(empty)
  } else elements.toc.append(buildList(items))
  elements.tocCount.textContent = count ? `${count} 项` : ''
}

function markCurrentToc(href) {
  tocButtons.forEach(button => button.classList.remove('active'))
  const button = tocButtons.get(String(href))
  button?.classList.add('active')
  button?.scrollIntoView({ block: 'nearest' })
}

function loadAnnotations() {
  annotations = normalizeAnnotations(currentRecord?.annotations)
  annotationFilterQuery = ''
  annotationFilterType = 'all'
  annotationSort = 'newest'
  selectedAnnotationIds.clear()
  elements.annotationFilterQuery.value = ''
  elements.annotationFilterType.value = 'all'
  elements.annotationSort.value = 'newest'
  renderAnnotationList()
}

async function saveAnnotations() {
  if (!currentRecord) return
  currentRecord = { ...currentRecord, annotations }
  continuousEbook?.setAnnotations(annotations)
  renderAnnotationList()
  if (currentRecord.id) await bookRepository.update(currentRecord.id, { annotations }).catch(console.error)
}

function renderAnnotationList() {
  elements.annotationList.replaceChildren()
  const existingIds = new Set(annotations.map(annotation => annotation.id))
  for (const id of selectedAnnotationIds) {
    if (!existingIds.has(id)) selectedAnnotationIds.delete(id)
  }
  const filtered = sortAnnotations(filterAnnotations(annotations, {
    query: annotationFilterQuery,
    type: annotationFilterType,
  }), annotationSort)
  elements.annotationCount.textContent = filtered.length === annotations.length
    ? `${annotations.length} 条`
    : `${filtered.length} / ${annotations.length} 条`
  updateBulkAnnotationControls(filtered)
  if (!filtered.length) {
    const empty = document.createElement('p')
    empty.className = 'tool-empty'
    empty.textContent = annotations.length ? '没有符合筛选条件的批注' : '还没有高亮或批注'
    elements.annotationList.append(empty)
    return
  }
  for (const annotation of filtered) {
    const item = document.createElement('article')
    item.className = 'annotation-item'
    const selection = document.createElement('input')
    selection.type = 'checkbox'
    selection.className = 'annotation-select'
    selection.setAttribute('aria-label', '选择这条批注')
    selection.checked = selectedAnnotationIds.has(annotation.id)
    selection.addEventListener('change', () => {
      if (selection.checked) selectedAnnotationIds.add(annotation.id)
      else selectedAnnotationIds.delete(annotation.id)
      updateBulkAnnotationControls(filtered)
    })
    const jump = document.createElement('button')
    jump.type = 'button'
    jump.className = 'annotation-jump'
    const location = annotation.kind === 'pdf' ? `第 ${annotation.page} 页` : '电子书高亮'
    jump.innerHTML = `<small>${location}</small><q></q>${annotation.note ? '<p></p>' : ''}`
    jump.querySelector('q').textContent = annotation.text || '无文本高亮'
    if (annotation.anchorStatus === 'unresolved') {
      item.classList.add('is-unresolved')
      const status = document.createElement('span')
      status.className = 'annotation-anchor-status'
      status.textContent = '需要重新定位'
      jump.append(status)
    }
    const note = jump.querySelector('p')
    if (note) note.textContent = annotation.note
    if (annotation.tags?.length) {
      const tags = document.createElement('div')
      tags.className = 'annotation-tags'
      for (const value of annotation.tags) {
        const tag = document.createElement('span')
        tag.textContent = value
        tags.append(tag)
      }
      jump.append(tags)
    }
    jump.addEventListener('click', () => {
      closePanels()
      if (annotation.kind === 'pdf') goToPdfPage(annotation.page)
      else if (continuousEbook) continuousEbook.goTo(annotation.locator)
      else ebookView?.showAnnotation({ value: annotation.locator })
    })
    const actions = document.createElement('div')
    actions.className = 'annotation-item-actions'
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'annotation-edit'
    edit.textContent = '编辑'
    edit.addEventListener('click', async () => {
      const noteValue = prompt('编辑批注（留空则仅保留高亮）', annotation.note || '')
      if (noteValue === null) return
      const tagsValue = prompt('编辑标签（使用逗号分隔，最多 10 个）', annotation.tags?.join(', ') || '')
      if (tagsValue === null) return
      annotations = updateAnnotation(annotations, annotation.id, { note: noteValue, tags: tagsValue })
      await saveAnnotations()
      renderPdfAnnotationOverlays()
      showToast('批注已更新')
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'annotation-delete'
    remove.textContent = '删除'
    remove.addEventListener('click', async () => {
      if (!confirm('确定删除这条高亮或批注吗？')) return
      await removeAnnotations([annotation])
    })
    actions.append(edit, remove)
    item.append(selection, jump, actions)
    elements.annotationList.append(item)
  }
}

function updateBulkAnnotationControls(filtered) {
  const visibleIds = filtered.map(annotation => annotation.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedAnnotationIds.has(id))
  elements.annotationSelectAll.textContent = allVisibleSelected ? '取消全选' : '全选当前'
  elements.annotationSelectAll.disabled = visibleIds.length === 0
  elements.annotationDeleteSelected.disabled = selectedAnnotationIds.size === 0
  elements.annotationDeleteSelected.textContent = selectedAnnotationIds.size
    ? `删除所选（${selectedAnnotationIds.size}）`
    : '删除所选'
}

function toggleSelectVisibleAnnotations() {
  const filtered = sortAnnotations(filterAnnotations(annotations, {
    query: annotationFilterQuery,
    type: annotationFilterType,
  }), annotationSort)
  const allSelected = filtered.length > 0 && filtered.every(annotation => selectedAnnotationIds.has(annotation.id))
  for (const annotation of filtered) {
    if (allSelected) selectedAnnotationIds.delete(annotation.id)
    else selectedAnnotationIds.add(annotation.id)
  }
  renderAnnotationList()
}

async function removeAnnotations(items) {
  const ids = new Set(items.map(annotation => annotation.id))
  if (!continuousEbook) {
    for (const annotation of items) {
      if (annotation.kind === 'ebook') await ebookView?.deleteAnnotation({ value: annotation.locator })
    }
  }
  annotations = annotations.filter(annotation => !ids.has(annotation.id))
  for (const id of ids) selectedAnnotationIds.delete(id)
  renderPdfAnnotationOverlays()
  await saveAnnotations()
}

async function deleteSelectedAnnotations() {
  const items = annotations.filter(annotation => selectedAnnotationIds.has(annotation.id))
  if (!items.length) return
  if (!confirm(`确定删除所选的 ${items.length} 条高亮或批注吗？`)) return
  await removeAnnotations(items)
  showToast(`已删除 ${items.length} 条批注`)
}

async function recoverImportedAnnotations(values, importedIds) {
  const recovered = []
  const ebookDocuments = new Map()
  for (const annotation of values) {
    if (!importedIds.has(annotation.id) || !annotation.anchor) {
      recovered.push(annotation)
      continue
    }
    try {
      recovered.push(annotation.kind === 'ebook'
        ? await recoverImportedEbookAnnotation(annotation, ebookDocuments)
        : await recoverImportedPdfAnnotation(annotation))
    } catch (error) {
      console.warn('Imported annotation recovery failed.', error)
      recovered.push({ ...annotation, anchorStatus: 'unresolved' })
    }
  }
  return recovered
}

async function recoverImportedEbookAnnotation(annotation, documents) {
  const origin = annotation.anchor.section ?? annotation.section
  if (!Number.isInteger(origin) || !ebookView?.book?.sections) {
    return { ...annotation, anchorStatus: 'unresolved' }
  }
  const candidates = []
  for (const index of nearbyLocations(origin, 1, ebookView.book.sections.length - 1)) {
    const section = ebookView.book.sections[index]
    if (!section?.createDocument) continue
    if (!documents.has(index)) documents.set(index, Promise.resolve(section.createDocument()))
    const doc = await documents.get(index)
    const text = doc.body?.textContent || doc.documentElement?.textContent || ''
    documents.set(index, doc)
    candidates.push({ location: index, text, preferredOffset: index === origin ? annotation.anchor.textOffset : null })
  }
  const match = recoverTextAnchor(annotation.anchor.quote, candidates)
  const doc = match ? documents.get(match.location) : null
  const range = doc?.body ? rangeFromTextOffsets(doc.body, match.start, match.end) : null
  if (!match || !range) return { ...annotation, anchorStatus: 'unresolved' }
  const locator = ebookView.getCFI(match.location, range)
  return {
    ...annotation,
    locator,
    section: match.location,
    anchorStatus: 'resolved',
    anchor: {
      ...annotation.anchor,
      section: match.location,
      cfi: locator,
      textOffset: match.start,
      quote: match.quote,
    },
  }
}

async function recoverImportedPdfAnnotation(annotation) {
  const origin = annotation.anchor.page ?? annotation.page
  if (!Number.isInteger(origin) || !pdfDocument) return { ...annotation, anchorStatus: 'unresolved' }
  const candidates = []
  for (const page of nearbyLocations(origin, 2, pdfDocument.numPages, 1)) {
    const { content } = await getPdfPageText(page)
    candidates.push({
      location: page,
      text: content.items.map(item => item.str || '').join(''),
      preferredOffset: page === origin ? annotation.anchor.textOffset : null,
    })
  }
  const match = recoverTextAnchor(annotation.anchor.quote, candidates)
  if (!match) return { ...annotation, anchorStatus: 'unresolved' }
  return {
    ...annotation,
    page: match.location,
    locator: `page:${match.location}`,
    rects: [],
    anchorStatus: 'resolved',
    anchor: {
      ...annotation.anchor,
      page: match.location,
      textOffset: match.start,
      quote: match.quote,
    },
  }
}

function nearbyLocations(origin, distance, maximum, minimum = 0) {
  const result = [origin]
  for (let offset = 1; offset <= distance; offset += 1) {
    if (origin - offset >= minimum) result.push(origin - offset)
    if (origin + offset <= maximum) result.push(origin + offset)
  }
  return result
}

async function importAnnotationsFile(file) {
  if (!file || !currentRecord) return
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('批注文件不能超过 10 MB')
    const document = parseAnnotationImport(await file.text())
    const matches = annotationImportMatchesBook(document.book, {
      fileName: currentRecord.name,
      format: currentRecord.format,
    })
    if (!matches && !confirm('导入文件属于另一本书，仍要合并到当前书籍吗？')) return
    const previousById = new Map(annotations.map(annotation => [annotation.id, annotation]))
    const recoverableIds = new Set(document.annotations.flatMap(annotation => {
      const local = previousById.get(annotation.id)
      if (!local) return [annotation.id]
      const localTime = local.updatedAt ?? local.createdAt
      const importedTime = annotation.updatedAt ?? annotation.createdAt
      return importedTime > localTime ? [annotation.id] : []
    }))
    const result = mergeAnnotationImports(annotations, document.annotations)
    annotations = await recoverImportedAnnotations(result.annotations, recoverableIds)
    if (!continuousEbook) {
      const importedIds = new Set(document.annotations.map(annotation => annotation.id))
      for (const annotation of annotations.filter(item => importedIds.has(item.id) && item.anchorStatus !== 'unresolved')) {
        if (annotation.kind !== 'ebook') continue
        const previous = previousById.get(annotation.id)
        if (previous?.kind === 'ebook') {
          await ebookView?.deleteAnnotation({ value: previous.locator }).catch(() => {})
        }
        await ebookView?.deleteAnnotation({ value: annotation.locator }).catch(() => {})
        await ebookView?.addAnnotation({ value: annotation.locator, color: annotation.color }).catch(() => {})
      }
    }
    renderPdfAnnotationOverlays()
    await saveAnnotations()
    showToast(`导入完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`)
  } catch (error) {
    console.error(error)
    showToast(error?.message || '无法导入批注文件', 'error')
  } finally {
    elements.annotationImportInput.value = ''
  }
}

function exportAnnotations(extension) {
  if (!annotations.length || !currentRecord) {
    showToast('当前书籍还没有可导出的高亮或批注')
    return
  }
  const exportDocument = createAnnotationExport(currentRecord, annotations)
  const text = extension === 'json'
    ? serializeAnnotationsJson(exportDocument)
    : serializeAnnotationsMarkdown(exportDocument)
  const type = extension === 'json' ? 'application/json' : 'text/markdown'
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = annotationExportFileName(exportDocument, extension)
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  showToast(`已导出 ${annotations.length} 条高亮与批注`)
}

function addSearchResult({ label, text, onSelect }) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'search-result'
  const heading = document.createElement('strong')
  heading.textContent = label
  const body = document.createElement('span')
  body.textContent = text
  button.append(heading, body)
  button.addEventListener('click', () => { onSelect(); closePanels() })
  elements.searchResults.append(button)
}

function renderEbookSearchSnapshot(snapshot) {
  elements.searchResults.replaceChildren()
  for (const result of snapshot.results.slice(0, 300)) addSearchResult({
    label: result.label,
    text: result.context.text,
    onSelect: () => navigateEbookTo(result.locator),
  })
  const count = snapshot.results.length
  elements.searchStatus.textContent = count ? `正在搜索，已找到 ${count} 处…` : '正在搜索…'
}

async function searchEbook(query, signal) {
  if (!ebookSearchIndex) throw new Error('Ebook search index is unavailable')
  const currentSectionIndex = continuousEbook?.currentLocation()?.index
    ?? ebookView?.lastLocation?.section?.current
    ?? 0
  const outcome = await ebookSearchIndex.search(query, {
    signal,
    batchSize: 1,
    currentSectionIndex,
    onBatch: renderEbookSearchSnapshot,
  })
  renderEbookSearchSnapshot(outcome)
  const count = outcome.results.length
  elements.searchStatus.textContent = count
    ? `找到 ${count} 处结果${count > 300 ? '（显示前 300 条）' : ''}${outcome.errors.length ? `，${outcome.errors.length} 章未能搜索` : ''}`
    : outcome.errors.length ? '没有找到匹配内容，部分章节未能搜索' : '没有找到匹配内容'
}

async function getPdfPageText(pageNumber) {
  if (pdfTextCache.has(pageNumber)) return pdfTextCache.get(pageNumber)
  const page = await pdfDocument.getPage(pageNumber)
  const content = await page.getTextContent()
  const text = content.items.map(item => item.str || '').join(' ')
  const value = { text, content }
  pdfTextCache.set(pageNumber, value)
  return value
}

async function searchPdf(query, signal) {
  pdfSearchQuery = query
  let count = 0
  for (let page = 1; page <= pdfDocument.numPages; page += 1) {
    signal.throwIfAborted()
    const wasCached = pdfTextCache.has(page)
    const { text } = await getPdfPageText(page)
    signal.throwIfAborted()
    const matches = findTextMatches(text, query)
    for (const index of matches.slice(0, 30)) {
      count += 1
      if (count <= 300) addSearchResult({
        label: `第 ${page} 页`,
        text: createSearchContext(text, index, query.length).text,
        onSelect: () => goToPdfPage(page),
      })
    }
    elements.searchStatus.textContent = `正在搜索 ${Math.round(page / pdfDocument.numPages * 100)}%…`
    if (!wasCached) await new Promise(resolve => setTimeout(resolve, 0))
  }
  signal.throwIfAborted()
  elements.searchStatus.textContent = count ? `找到 ${count} 处结果${count > 300 ? '（显示前 300 条）' : ''}` : '没有找到匹配内容'
  elements.pdfPages.querySelectorAll('.textLayer').forEach(markPdfSearchMatches)
}

async function runSearch(event) {
  event?.preventDefault()
  const query = elements.searchInput.value.trim()
  searchAbortController?.abort()
  searchAbortController = null
  elements.searchResults.replaceChildren()
  if (!query) {
    ebookView?.clearSearch?.()
    pdfSearchQuery = ''
    elements.searchStatus.textContent = '输入关键词搜索整本书'
    elements.pdfPages.querySelectorAll('.pdf-search-match').forEach(node => node.classList.remove('pdf-search-match'))
    return
  }
  const controller = new AbortController()
  searchAbortController = controller
  elements.searchStatus.textContent = '正在搜索…'
  try {
    if (currentFormat === 'pdf') await searchPdf(query, controller.signal)
    else await searchEbook(query, controller.signal)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error(error)
      if (searchAbortController === controller) elements.searchStatus.textContent = '搜索失败，请换一个关键词重试'
    }
  } finally {
    if (searchAbortController === controller) searchAbortController = null
  }
}

function markPdfSearchMatches(textLayer) {
  textLayer.querySelectorAll('.pdf-search-match').forEach(node => node.classList.remove('pdf-search-match'))
  if (!pdfSearchQuery) return
  const query = pdfSearchQuery.toLocaleLowerCase()
  textLayer.querySelectorAll('span').forEach(span => {
    if (span.textContent.toLocaleLowerCase().includes(query)) span.classList.add('pdf-search-match')
  })
}

function updateAiSelectionUi() {
  const valid = pendingSelection && pendingSelection.kind === (currentFormat === 'pdf' ? 'pdf' : 'ebook')
  elements.selectionAiMenu.hidden = !valid
  elements.aiSelectionPreview.textContent = valid
    ? `已选择 ${pendingSelection.text.length} 个字符：${excerpt(pendingSelection.text, '', 72)}`
    : '选中文字后，可以解释、翻译或补充背景。'
}

function saveAiConfiguration() {
  settings.aiEndpoint = elements.aiEndpoint.value.trim()
  settings.aiModel = elements.aiModel.value.trim()
  settings.aiApiKey = elements.aiApiKey.value.trim()
  saveSettings(settings)
  elements.aiSettings.hidden = true
  showToast('AI 设置已保存在当前浏览器')
}

async function ensureAiPermission(endpoint) {
  if (!globalThis.chrome?.permissions) return true
  const origins = [getAiPermissionOrigin(endpoint)]
  return chrome.permissions.request({ origins })
}

function setAiBusy(busy) {
  elements.aiActionButtons.forEach(button => { button.disabled = busy })
  elements.aiStop.hidden = !busy
}

async function getCurrentChapterContext() {
  if (currentFormat === 'pdf') {
    if (!pdfDocument) throw new Error('PDF 尚未加载完成')
    const start = Math.max(1, currentPdfPage - 1)
    const end = Math.min(pdfDocument.numPages, currentPdfPage + 1)
    const pages = []
    for (let page = start; page <= end; page += 1) {
      const { text } = await getPdfPageText(page)
      if (text.trim()) pages.push(`[第 ${page} 页]\n${text}`)
    }
    return {
      text: pages.join('\n\n'),
      chapter: start === end ? `PDF 第 ${start} 页` : `PDF 第 ${start}–${end} 页（当前页附近）`,
    }
  }
  if (!ebookView?.book) throw new Error('电子书尚未加载完成')
  const continuousContext = continuousEbook?.getCurrentDocument()
  const sectionIndex = continuousContext?.index ?? ebookView.lastLocation?.section?.current ?? pendingSelection?.index ?? 0
  const section = ebookView.book.sections?.[sectionIndex]
  if (!continuousContext?.doc && !section?.createDocument) throw new Error('无法读取当前章节')
  const doc = continuousContext?.doc || await section.createDocument()
  const text = doc.body?.textContent || doc.documentElement?.textContent || ''
  return {
    text,
    chapter: displayValue(continuousEbook?.currentLocation()?.tocItem?.label)
      || displayValue(ebookView.lastLocation?.tocItem?.label)
      || elements.chapterLabel.textContent || `第 ${sectionIndex + 1} 节`,
  }
}

async function runAiAction(scope, action) {
  const selectionContext = scope === 'selection' ? pendingSelection?.text : ''
  if (scope === 'selection' && !selectionContext) {
    showToast('请先在正文中选中一段文字')
    return
  }
  const config = {
    endpoint: elements.aiEndpoint.value.trim(),
    model: elements.aiModel.value.trim(),
    apiKey: elements.aiApiKey.value.trim(),
  }
  if (!config.endpoint || !config.model) {
    openPanel(elements.toolsPanel)
    elements.aiSettings.hidden = false
    showToast('请先填写 AI 接口地址和模型名称', 'error')
    return
  }

  try {
    const granted = await ensureAiPermission(config.endpoint)
    if (!granted) {
      showToast('需要允许访问所填写的 AI 接口', 'error')
      return
    }
    openPanel(elements.toolsPanel)
    elements.selectionAiMenu.hidden = true
    const context = scope === 'selection'
      ? { text: selectionContext, chapter: elements.chapterLabel.textContent }
      : await getCurrentChapterContext()
    const actionLabel = scope === 'selection' ? SELECTION_AI_ACTIONS[action] : CHAPTER_AI_ACTIONS[action]
    const messages = buildAiMessages({
      scope,
      action,
      text: context.text,
      title: elements.sidebarTitle.textContent || elements.headerTitle.textContent,
      chapter: context.chapter,
    })
    aiAbortController?.abort()
    aiAbortController = new AbortController()
    elements.aiResult.hidden = false
    elements.aiResultTitle.textContent = actionLabel || 'AI 回答'
    elements.aiResultStatus.textContent = scope === 'selection'
      ? `本次发送选中文字，共 ${selectionContext.length} 个字符`
      : `本次发送 ${context.chapter} 的文字，最多 24000 个字符`
    elements.aiResultContent.textContent = ''
    setAiBusy(true)
    await streamAiCompletion({
      ...config,
      messages,
      signal: aiAbortController.signal,
      onChunk: chunk => {
        elements.aiResultContent.textContent += chunk
        elements.aiResultContent.scrollTop = elements.aiResultContent.scrollHeight
      },
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      elements.aiResultStatus.textContent = '已停止生成'
    } else {
      console.error(error)
      elements.aiResultStatus.textContent = error?.message || 'AI 请求失败，请检查接口设置'
      showToast('AI 请求失败，请检查接口设置', 'error')
    }
  } finally {
    aiAbortController = null
    setAiBusy(false)
  }
}
function captureEbookSelection(doc, index) {
  const selection = doc.defaultView.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount || !doc.body) return
  const text = selection.toString().trim()
  if (!text) return
  pendingSelection = { kind: 'ebook', index, root: doc.body, range: selection.getRangeAt(0).cloneRange(), text }
  updateAiSelectionUi()
}

function capturePdfSelection(wrapper) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return
  const range = selection.getRangeAt(0)
  const textLayer = wrapper.querySelector('.textLayer')
  if (!textLayer?.contains(range.commonAncestorContainer)) return
  const rects = relativeRectsForRange(wrapper, range)
  const rangeAnchor = createRangeAnchor(textLayer, range)
  const text = selection.toString().trim()
  if (!text || !rects.length) return
  const page = Number(wrapper.dataset.page)
  pendingSelection = {
    kind: 'pdf',
    page,
    text,
    rects,
    anchor: rangeAnchor ? {
      version: 1,
      kind: 'pdf',
      page,
      textOffset: rangeAnchor.textOffset,
      quote: rangeAnchor.quote,
    } : undefined,
  }
  updateAiSelectionUi()
}

async function annotateSelection(withNote) {
  if (!pendingSelection || pendingSelection.kind !== (currentFormat === 'pdf' ? 'pdf' : 'ebook')) {
    showToast('请先在正文中选中一段文字')
    return
  }
  const note = withNote ? prompt('写下批注（可留空，仅保存高亮）', '') : ''
  if (withNote && note === null) return
  let annotation
  if (pendingSelection.kind === 'ebook') {
    const locator = ebookView.getCFI(pendingSelection.index, pendingSelection.range)
    const rangeAnchor = createRangeAnchor(pendingSelection.root, pendingSelection.range)
    const anchor = rangeAnchor ? {
      version: 1,
      kind: 'ebook',
      section: pendingSelection.index,
      cfi: locator,
      textOffset: rangeAnchor.textOffset,
      quote: rangeAnchor.quote,
    } : undefined
    annotation = createAnnotation({
      kind: 'ebook',
      locator,
      text: pendingSelection.text,
      note,
      section: pendingSelection.index,
      anchor,
      anchorStatus: anchor ? 'resolved' : undefined,
    })
    annotations.push(annotation)
    if (continuousEbook) {
      continuousEbook.setAnnotations(annotations)
      continuousEbook.deselect()
    } else {
      await ebookView.addAnnotation({ value: locator, color: annotation.color, note })
      ebookView.deselect()
    }
  } else {
    annotation = createAnnotation({
      kind: 'pdf',
      page: pendingSelection.page,
      locator: `page:${pendingSelection.page}`,
      text: pendingSelection.text,
      note,
      rects: pendingSelection.rects,
      anchor: pendingSelection.anchor,
      anchorStatus: pendingSelection.anchor ? 'resolved' : undefined,
    })
    annotations.push(annotation)
    window.getSelection()?.removeAllRanges()
    renderPdfAnnotationOverlays(annotation.page)
  }
  pendingSelection = null
  updateAiSelectionUi()
  await saveAnnotations()
  showToast(withNote ? '批注已保存' : '高亮已保存')
}

function scheduleAnnotationRepairSave() {
  if (annotationRepairSave != null) return
  annotationRepairSave = setTimeout(() => {
    annotationRepairSave = null
    saveAnnotations().catch(console.error)
  }, 0)
}

function validEbookAnnotationRange(range, annotation) {
  if (!range || range.collapsed) return false
  if (!annotation.anchor?.quote?.normalizedExact) return true
  return normalizeAnchorText(range.toString()).text === annotation.anchor.quote.normalizedExact
}

function resolveEbookAnnotationRange(doc, index, annotation) {
  try {
    const resolved = ebookView.resolveNavigation(annotation.locator)
    if (resolved?.index === index) {
      const range = resolved.anchor?.(doc)
      if (validEbookAnnotationRange(range, annotation)) return { range, repaired: false }
    }
  } catch (error) {
    console.warn('Stored ebook CFI could not be resolved.', error)
  }
  if (annotation.anchor?.kind !== 'ebook' || !doc.body) return null
  const fallback = resolveRangeAnchor(doc.body, annotation.anchor.quote, annotation.anchor.textOffset)
  if (!fallback) return null
  return { range: fallback.range, textOffset: fallback.textOffset, repaired: true }
}

async function repairEbookAnnotationAnchors(doc, index) {
  let changed = false
  for (const annotation of annotations.filter(item => item.kind === 'ebook' && item.section === index && item.anchor?.kind === 'ebook')) {
    const resolved = resolveEbookAnnotationRange(doc, index, annotation)
    if (!resolved?.repaired) continue
    const locator = ebookView.getCFI(index, resolved.range)
    annotation.locator = locator
    annotation.anchor = { ...annotation.anchor, cfi: locator, textOffset: resolved.textOffset }
    annotation.anchorStatus = 'resolved'
    await ebookView.addAnnotation({ value: locator, color: annotation.color, note: annotation.note }).catch(console.error)
    changed = true
  }
  if (changed) scheduleAnnotationRepairSave()
}

function relativeRectsForRange(wrapper, range) {
  const bounds = wrapper.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return []
  return [...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => ({
    left: (rect.left - bounds.left) / bounds.width,
    top: (rect.top - bounds.top) / bounds.height,
    width: rect.width / bounds.width,
    height: rect.height / bounds.height,
  }))
}

function sameAnnotationRects(left, right) {
  if (left.length !== right.length) return false
  return left.every((rect, index) => {
    const other = right[index]
    return other && ['left', 'top', 'width', 'height']
      .every(key => Math.abs(rect[key] - other[key]) < 0.0001)
  })
}

function resolvePdfAnnotationRects(wrapper, annotation) {
  if (annotation.anchorStatus === 'unresolved') return []
  if (annotation.anchor?.kind !== 'pdf') return annotation.rects || []
  const textLayer = wrapper.querySelector('.textLayer')
  if (!textLayer) return []
  const resolved = resolveRangeAnchor(textLayer, annotation.anchor.quote, annotation.anchor.textOffset)
  if (!resolved) return []
  const rects = relativeRectsForRange(wrapper, resolved.range)
  if (!rects.length) return []
  if (!sameAnnotationRects(annotation.rects || [], rects)
    || annotation.anchor.textOffset !== resolved.textOffset) {
    annotation.rects = rects
    annotation.anchor = { ...annotation.anchor, textOffset: resolved.textOffset }
    annotation.anchorStatus = 'resolved'
    scheduleAnnotationRepairSave()
  }
  return rects
}

function renderPdfAnnotationOverlays(pageNumber = null) {
  const wrappers = pageNumber
    ? [elements.pdfPages.querySelector(`[data-page="${pageNumber}"]`)].filter(Boolean)
    : [...elements.pdfPages.querySelectorAll('.pdf-page')]
  for (const wrapper of wrappers) {
    wrapper.querySelectorAll('.pdf-annotation-layer').forEach(node => node.remove())
    if (wrapper.dataset.state !== 'rendered') continue
    const layer = document.createElement('div')
    layer.className = 'pdf-annotation-layer'
    for (const annotation of annotations.filter(item => item.kind === 'pdf' && item.page === Number(wrapper.dataset.page))) {
      for (const rect of resolvePdfAnnotationRects(wrapper, annotation)) {
        const mark = document.createElement('span')
        mark.style.left = `${rect.left * 100}%`
        mark.style.top = `${rect.top * 100}%`
        mark.style.width = `${rect.width * 100}%`
        mark.style.height = `${rect.height * 100}%`
        mark.title = annotation.note || annotation.text
        mark.addEventListener('click', () => annotation.note && showToast(annotation.note))
        layer.append(mark)
      }
    }
    wrapper.append(layer)
  }
}
async function openEbook(file) {
  document.body.classList.remove('pdf-mode')
  elements.ebookHost.hidden = false
  elements.pdfViewport.hidden = true
  document.querySelectorAll('.ebook-setting').forEach(item => { item.hidden = false })
  elements.panelTip.textContent = '方向键翻页，Esc 收起面板'
  elements.pdfToolbar.hidden = true
  elements.pdfPageJump.hidden = true
  setLoading('解析电子书结构与目录…')

  ebookView = document.createElement('foliate-view')
  elements.ebookHost.append(ebookView)
  ebookView.addEventListener('relocate', ({ detail }) => {
    if (!continuousEbook) handleEbookRelocate(detail)
  })
  ebookView.addEventListener('draw-annotation', ({ detail: { draw, annotation } }) => draw(Overlayer.highlight, { color: annotation.color || '#f4c95d' }))
  ebookView.addEventListener('create-overlay', ({ detail: { index } }) => {
    for (const annotation of annotations.filter(item => item.kind === 'ebook' && item.anchorStatus !== 'unresolved' && (item.section == null || item.section === index))) ebookView.addAnnotation({ value: annotation.locator, color: annotation.color, note: annotation.note })
  })
  ebookView.addEventListener('show-annotation', ({ detail }) => {
    const annotation = annotations.find(item => item.locator === detail.value)
    if (annotation?.note) showToast(annotation.note)
  })
  ebookView.addEventListener('external-link', event => {
    if (!confirm('这本书想要打开一个外部链接，是否继续？')) event.preventDefault()
  })
  ebookView.addEventListener('load', ({ detail: { doc, index } }) => {
    doc.addEventListener('mouseup', () => captureEbookSelection(doc, index))
    doc.addEventListener('selectionchange', () => captureEbookSelection(doc, index))
    repairEbookAnnotationAnchors(doc, index).catch(console.error)
  })

  await ebookView.open(file)
  ebookSearchIndex = createEbookSearchIndex()
  applyReaderSettings()
  const metadata = ebookView.book.metadata || {}
  const cover = await Promise.resolve(ebookView.book.getCover?.()).catch(() => null)
  await setMetadata({ title: metadata.title, author: metadata.author, cover })
  readerAdapter = createEbookReaderAdapter({
    format: currentFormat,
    goTo: target => navigateEbookTo(target),
    goToFraction: fraction => continuousEbook ? continuousEbook.goToFraction(fraction) : ebookView?.goToFraction(fraction),
    goLeft: () => continuousEbook ? continuousEbook.scrollByPage(-1) : ebookView?.goLeft(),
    goRight: () => continuousEbook ? continuousEbook.scrollByPage(1) : ebookView?.goRight(),
    getLocation: () => continuousEbook?.currentLocation() || ebookView?.lastLocation || null,
  })
  renderToc(ebookView.book.toc, item => navigateEbookTo(item.href).catch(error => showToast(error.message, 'error')))

  const rendered = await initializeEbookPosition(ebookView, currentRecord?.progress)
  if (!rendered) throw new Error('No readable EPUB section could be rendered')
  if (settings.flow === 'scrolled') await setEbookFlow('scrolled', ebookView.lastLocation || currentRecord?.progress)
  hideLoading()
}

function createEbookSearchIndex() {
  const sections = ebookView.book.sections.flatMap((section, index) => {
    if (!section?.createDocument) return []
    let documentPromise = null
    const loadDocument = () => {
      documentPromise ||= Promise.resolve(section.createDocument())
      return documentPromise
    }
    return [{
      index,
      label: displayValue(ebookView.getProgressOf(index)?.tocItem?.label) || `第 ${index + 1} 章`,
      loadText: async () => {
        const doc = await loadDocument()
        await new Promise(resolve => setTimeout(resolve, 0))
        return doc.body?.textContent || doc.documentElement?.textContent || ''
      },
      createLocator: async (offset, length) => {
        const doc = await loadDocument()
        const root = doc.body || doc.documentElement
        const range = root ? rangeFromTextOffsets(root, offset, offset + length) : null
        if (!range) throw new Error(`Unable to locate search result in section ${index}`)
        return ebookView.getCFI(index, range)
      },
    }]
  })
  return new EbookSearchIndex(sections)
}

async function loadPdfOutline(pdf) {
  const outline = await pdf.getOutline().catch(() => null)
  const convert = items => (items || []).map(item => ({
    label: item.title,
    href: item.dest,
    subitems: convert(item.items),
  }))
  const converted = convert(outline)
  renderToc(converted, async item => {
    let destination = item.href
    if (typeof destination === 'string') destination = await pdf.getDestination(destination)
    const reference = destination?.[0]
    if (!reference) return
    const index = typeof reference === 'object' ? await pdf.getPageIndex(reference) : reference
    goToPdfPage(index + 1)
  })
}

async function renderPdfPage(pageNumber) {
  const wrapper = elements.pdfPages.querySelector(`[data-page="${pageNumber}"]`)
  if (!wrapper || wrapper.dataset.state === 'rendered' || wrapper.dataset.state === 'rendering') return
  wrapper.dataset.state = 'rendering'
  try {
    const page = await pdfDocument.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const availableWidth = Math.max(320, Math.min(900, elements.pdfViewport.clientWidth - 64))
    const cssScale = availableWidth / baseViewport.width * pdfZoom
    const cssViewport = page.getViewport({ scale: cssScale })
    const pixelRatio = Math.min(devicePixelRatio || 1, 2)
    const renderViewport = page.getViewport({ scale: cssScale * pixelRatio })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(renderViewport.width)
    canvas.height = Math.floor(renderViewport.height)
    canvas.style.width = `${Math.floor(cssViewport.width)}px`
    canvas.style.height = `${Math.floor(cssViewport.height)}px`
    wrapper.style.width = `${Math.floor(cssViewport.width)}px`
    wrapper.style.height = `${Math.floor(cssViewport.height)}px`
    wrapper.style.aspectRatio = `${baseViewport.width}/${baseViewport.height}`
    const textLayer = document.createElement('div')
    textLayer.className = 'textLayer'
    wrapper.replaceChildren(canvas, textLayer)
    const pageLabel = document.createElement('span')
    pageLabel.className = 'pdf-page-number'
    pageLabel.textContent = String(pageNumber)
    wrapper.append(pageLabel)
    const { content } = await getPdfPageText(pageNumber)
    await Promise.all([
      page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: renderViewport }).promise,
      new pdfjsLib.TextLayer({ textContentSource: content, container: textLayer, viewport: cssViewport }).render(),
    ])
    markPdfSearchMatches(textLayer)
    textLayer.addEventListener('mouseup', () => capturePdfSelection(wrapper))
    wrapper.dataset.state = 'rendered'
    renderPdfAnnotationOverlays(pageNumber)
  } catch (error) {
    wrapper.dataset.state = 'error'
    wrapper.textContent = `第 ${pageNumber} 页渲染失败`
    console.error(error)
  }
}

function invalidatePdfPages() {
  for (const wrapper of elements.pdfPages.children) {
    wrapper.dataset.state = 'idle'
    wrapper.replaceChildren(`第 ${wrapper.dataset.page} 页`)
  }
  renderPdfPage(currentPdfPage)
  renderPdfPage(Math.max(1, currentPdfPage - 1))
  renderPdfPage(Math.min(pdfDocument.numPages, currentPdfPage + 1))
}

function setPdfZoom(nextZoom) {
  if (!pdfDocument) return
  pdfZoom = Math.max(.6, Math.min(2.5, Math.round(nextZoom * 10) / 10))
  elements.pdfZoomLabel.textContent = `${Math.round(pdfZoom * 100)}%`
  invalidatePdfPages()
  requestAnimationFrame(() => goToPdfPage(currentPdfPage, false))
}
function updatePdfPosition() {
  const viewportRect = elements.pdfViewport.getBoundingClientRect()
  const targetY = viewportRect.top + viewportRect.height * .42
  let closest = null
  let distance = Infinity
  for (const page of elements.pdfPages.children) {
    const rect = page.getBoundingClientRect()
    const pageDistance = Math.abs(rect.top + rect.height / 2 - targetY)
    if (pageDistance < distance) { distance = pageDistance; closest = page }
  }
  if (!closest) return
  currentPdfPage = Number(closest.dataset.page)
  elements.pdfPageInput.value = currentPdfPage
  const fraction = pdfDocument.numPages > 1 ? (currentPdfPage - 1) / (pdfDocument.numPages - 1) : 1
  updateProgress(fraction, `第 ${currentPdfPage} 页 / 共 ${pdfDocument.numPages} 页`)
  scheduleProgressSave({ kind: 'pdf', page: currentPdfPage, fraction })
}

function goToPdfPage(pageNumber, smooth = true) {
  if (!pdfDocument) return
  currentPdfPage = Math.max(1, Math.min(pdfDocument.numPages, Math.round(pageNumber)))
  const page = elements.pdfPages.querySelector(`[data-page="${currentPdfPage}"]`)
  page?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
  elements.pdfPageInput.value = currentPdfPage
  renderPdfPage(currentPdfPage)
}

async function openPdf(file) {
  document.body.classList.add('pdf-mode')
  elements.ebookHost.hidden = true
  elements.pdfViewport.hidden = false
  document.querySelectorAll('.ebook-setting').forEach(item => { item.hidden = true })
  elements.panelTip.textContent = 'PDF 支持文字选择、缩放、搜索与页码跳转'
  elements.pdfToolbar.hidden = false
  elements.pdfPageJump.hidden = false
  pdfZoom = 1
  elements.pdfZoomLabel.textContent = '100%'
  setLoading('读取 PDF 页面与书签…')
  await setMetadata({ title: file.name.replace(/\.pdf$/i, ''), author: '', cover: null })

  const baseUrl = globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL('node_modules/pdfjs-dist/') : new URL('../node_modules/pdfjs-dist/', import.meta.url).href
  pdfLoadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${baseUrl}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${baseUrl}standard_fonts/`,
    wasmUrl: `${baseUrl}wasm/`,
  })
  pdfDocument = await pdfLoadingTask.promise
  readerAdapter = createPdfReaderAdapter({
    goToPage: page => goToPdfPage(page),
    getPage: () => currentPdfPage,
    getPageCount: () => pdfDocument?.numPages || 1,
  })
  elements.pdfPageInput.max = pdfDocument.numPages
  elements.pdfPageTotal.textContent = `/ ${pdfDocument.numPages}`
  const metadataResult = await pdfDocument.getMetadata().catch(() => null)
  if (metadataResult?.info) {
    await setMetadata({
      title: metadataResult.info.Title || file.name.replace(/\.pdf$/i, ''),
      author: metadataResult.info.Author || '',
      cover: null,
    })
  }

  const fragment = document.createDocumentFragment()
  for (let number = 1; number <= pdfDocument.numPages; number += 1) {
    const page = document.createElement('section')
    page.className = 'pdf-page'
    page.dataset.page = number
    page.dataset.state = 'idle'
    page.textContent = `第 ${number} 页`
    fragment.append(page)
  }
  elements.pdfPages.append(fragment)
  pdfObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) renderPdfPage(Number(entry.target.dataset.page))
  }, { root: elements.pdfViewport, rootMargin: '900px 0px' })
  elements.pdfPages.querySelectorAll('.pdf-page').forEach(page => pdfObserver.observe(page))
  elements.pdfViewport.onscroll = () => {
    cancelAnimationFrame(pdfScrollFrame)
    pdfScrollFrame = requestAnimationFrame(updatePdfPosition)
  }
  await loadPdfOutline(pdfDocument)
  const restoredPage = currentRecord?.progress?.kind === 'pdf' ? currentRecord.progress.page : 1
  hideLoading()
  requestAnimationFrame(() => goToPdfPage(restoredPage || 1))
}

async function openBook(file, existingRecord = null) {
  const format = detectFormat(file.name, file.type)
  closeReader()
  showReader()
  elements.headerTitle.textContent = file.name
  if (!format) {
    showOpenError(describeOpenError(null, null))
    return
  }

  currentFormat = format
  setLoading()
  elements.sidebarFormat.textContent = format.toUpperCase()
  let savedNewBook = false
  try {
    currentRecord = existingRecord || await bookRepository.save(file, format)
    savedNewBook = !existingRecord && Boolean(currentRecord?.id)
    loadAnnotations()
  } catch (error) {
    console.warn('The book could not be persisted locally.', error)
    currentRecord = existingRecord || { name: file.name, size: file.size, format, blob: file }
    loadAnnotations()
    showToast('存储空间不足，本次仍可阅读，但无法保存书籍', 'error')
  }
  try {
    if (format === 'pdf') await openPdf(file)
    else await openEbook(file)
  } catch (error) {
    console.error(error)
    const description = describeOpenError(error, format)
    if (savedNewBook && currentRecord?.id) {
      await bookRepository.delete(currentRecord.id).catch(cleanupError => console.error('Failed to remove invalid book.', cleanupError))
    }
    closeReader()
    showOpenError(description)
  }
}

async function openStoredBook(record) {
  if (!record.blob) { showToast('本地书籍数据已丢失，请重新选择文件', 'error'); return }
  const file = record.blob instanceof File
    ? record.blob
    : new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified })
  await bookRepository.update(record.id, { openedAt: Date.now() }).catch(console.error)
  await openBook(file, record)
}

async function renderLibrary() {
  libraryObjectUrls.forEach(URL.revokeObjectURL)
  libraryObjectUrls = []
  const books = await bookRepository.list().catch(() => [])
  elements.bookGrid.replaceChildren()
  elements.librarySection.hidden = books.length === 0
  for (const record of books) {
    const card = document.createElement('article')
    card.className = 'library-card'
    card.tabIndex = 0
    const cover = document.createElement('div')
    cover.className = 'mini-cover'
    if (record.cover) {
      const url = URL.createObjectURL(record.cover)
      libraryObjectUrls.push(url)
      const image = new Image()
      image.src = url
      image.alt = ''
      cover.append(image)
    } else cover.textContent = (record.metadata?.title || record.name || '书').slice(0, 1)
    const info = document.createElement('div')
    info.className = 'card-info'
    const title = document.createElement('div')
    title.className = 'card-title'
    title.textContent = record.metadata?.title || record.name.replace(/\.[^.]+$/, '')
    const meta = document.createElement('div')
    meta.className = 'card-meta'
    meta.textContent = `${record.format} · ${formatBytes(record.size)}`
    const progress = document.createElement('div')
    progress.className = 'card-progress'
    const bar = document.createElement('span')
    bar.style.width = `${Math.round((record.progress?.fraction || 0) * 100)}%`
    progress.append(bar)
    info.append(title, meta, progress)
    const remove = document.createElement('button')
    remove.className = 'delete-book'
    remove.type = 'button'
    remove.ariaLabel = '从书架移除'
    remove.textContent = '×'
    remove.addEventListener('click', async event => {
      event.stopPropagation()
      await bookRepository.delete(record.id)
      card.remove()
      if (!elements.bookGrid.children.length) elements.librarySection.hidden = true
    })
    const open = () => openStoredBook(record)
    card.addEventListener('click', open)
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open() })
    card.append(cover, info, remove)
    elements.bookGrid.append(card)
  }
}

function setBackupBusy(busy, message) {
  elements.backupLibrary.disabled = busy
  elements.restoreLibrary.disabled = busy
  elements.backupStatus.textContent = message
}

async function exportLibraryBackup() {
  setBackupBusy(true, '正在校验并打包本地书库…')
  elements.backupStatus.dataset.state = 'working'
  try {
    await progressService.flush()
    const records = await bookRepository.list()
    const archive = await createLibraryBackup(records, settings)
    const url = URL.createObjectURL(archive)
    const link = document.createElement('a')
    link.href = url
    link.download = backupFileName()
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    const message = `备份完成：${records.length} 本书；API 密钥未写入备份`
    setBackupBusy(false, message)
    elements.backupStatus.dataset.state = 'exported'
    showToast(message)
  } catch (error) {
    console.error(error)
    setBackupBusy(false, '备份失败，原书库未被修改')
    elements.backupStatus.dataset.state = 'error'
    showToast('书库备份失败，请重试', 'error')
  }
}

async function restoreLibraryBackup(file) {
  setBackupBusy(true, '正在验证备份完整性…')
  elements.backupStatus.dataset.state = 'working'
  try {
    const backup = await parseLibraryBackup(file)
    const currentApiKey = settings.aiApiKey
    await bookRepository.restore(backup.records)
    settings = { ...settings, ...backup.settings, aiApiKey: currentApiKey }
    applyReaderSettings()
    await renderLibrary()
    const message = `恢复完成：${backup.records.length} 本书；现有同名记录已更新`
    setBackupBusy(false, message)
    elements.backupStatus.dataset.state = 'restored'
    showToast(message)
  } catch (error) {
    console.error(error)
    setBackupBusy(false, '恢复失败，未写入未经验证的数据')
    elements.backupStatus.dataset.state = 'error'
    showToast('备份文件无效或已损坏', 'error')
  } finally {
    elements.backupFileInput.value = ''
  }
}

function openBackupPicker() {
  elements.backupFileInput.value = ''
  elements.backupFileInput.click()
}

function navigate(direction) {
  readerAdapter?.navigate(direction)
}

function bindControls() {
  elements.openButton.addEventListener('click', openPicker)
  elements.heroOpenButton.addEventListener('click', openPicker)
  elements.fileInput.addEventListener('change', event => {
    const [file] = event.target.files
    if (file) openBook(file)
  })
  elements.homeButton.addEventListener('click', showLibrary)
  elements.loadingLibraryButton.addEventListener('click', showLibrary)
  elements.loadingRetryButton.addEventListener('click', openPicker)
  elements.headerToggle.addEventListener('click', () => setHeaderCollapsed(!document.body.classList.contains('header-collapsed')))
  elements.sidebarButton.addEventListener('click', () => openPanel(elements.sidebar))
  elements.settingsButton.addEventListener('click', () => openPanel(elements.settingsPanel))
  elements.backupLibrary.addEventListener('click', exportLibraryBackup)
  elements.restoreLibrary.addEventListener('click', openBackupPicker)
  elements.backupFileInput.addEventListener('change', event => {
    const [file] = event.target.files
    if (file) restoreLibraryBackup(file)
  })

  elements.toolsButton.addEventListener('click', () => openPanel(elements.toolsPanel))
  elements.aiSettingsToggle.addEventListener('click', () => {
    elements.aiSettings.hidden = !elements.aiSettings.hidden
    if (!elements.aiSettings.hidden) elements.aiEndpoint.focus()
  })
  elements.saveAiSettings.addEventListener('click', saveAiConfiguration)
  elements.aiStop.addEventListener('click', () => aiAbortController?.abort())
  elements.closeSelectionAiMenu.addEventListener('click', () => { elements.selectionAiMenu.hidden = true })
  elements.aiActionButtons.forEach(button => button.addEventListener('click', () => runAiAction(button.dataset.aiScope, button.dataset.aiAction)))
  elements.closeTools.addEventListener('click', closePanels)
  elements.searchForm.addEventListener('submit', runSearch)
  elements.highlightSelection.addEventListener('click', () => annotateSelection(false))
  elements.noteSelection.addEventListener('click', () => annotateSelection(true))
  elements.annotationFilterQuery.addEventListener('input', event => {
    annotationFilterQuery = event.target.value
    renderAnnotationList()
  })
  elements.annotationFilterType.addEventListener('change', event => {
    annotationFilterType = event.target.value
    renderAnnotationList()
  })
  elements.annotationSort.addEventListener('change', event => {
    annotationSort = event.target.value
    renderAnnotationList()
  })
  elements.annotationSelectAll.addEventListener('click', toggleSelectVisibleAnnotations)
  elements.annotationDeleteSelected.addEventListener('click', deleteSelectedAnnotations)
  elements.importAnnotationsJson.addEventListener('click', () => {
    elements.annotationImportInput.value = ''
    elements.annotationImportInput.click()
  })
  elements.annotationImportInput.addEventListener('change', event => {
    const [file] = event.target.files
    if (file) importAnnotationsFile(file)
  })
  elements.exportAnnotationsMarkdown.addEventListener('click', () => exportAnnotations('md'))
  elements.exportAnnotationsJson.addEventListener('click', () => exportAnnotations('json'))
  elements.closeSettings.addEventListener('click', closePanels)
  elements.scrim.addEventListener('click', closePanels)
  elements.prevButton.addEventListener('click', () => navigate(-1))
  elements.nextButton.addEventListener('click', () => navigate(1))
  elements.pdfZoomOut.addEventListener('click', () => setPdfZoom(pdfZoom - .1))
  elements.pdfZoomIn.addEventListener('click', () => setPdfZoom(pdfZoom + .1))
  elements.pdfFitWidth.addEventListener('click', () => setPdfZoom(1))
  const jumpToInputPage = () => goToPdfPage(Number(elements.pdfPageInput.value))
  elements.pdfPageInput.addEventListener('change', jumpToInputPage)
  elements.pdfPageInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); jumpToInputPage() }
  })
  elements.progressSlider.addEventListener('input', event => {
    const fraction = Number(event.target.value)
    readerAdapter?.goToFraction(fraction)
  })

  document.querySelectorAll('[data-flow]').forEach(button => button.addEventListener('click', async () => {
    settings.flow = button.dataset.flow
    applyReaderSettings()
    try {
      await setEbookFlow(settings.flow)
    } catch (error) {
      console.error(error)
      showToast('阅读模式切换失败', 'error')
    }
  }))
  document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
    settings.theme = button.dataset.theme
    applyReaderSettings()
  }))
  elements.fontSelect.addEventListener('change', event => { settings.font = event.target.value; applyReaderSettings() })
  elements.fontSize.addEventListener('input', event => { settings.fontSize = Number(event.target.value); applyReaderSettings() })
  elements.lineHeight.addEventListener('input', event => { settings.lineHeight = Number(event.target.value); applyReaderSettings() })
  elements.pageWidth.addEventListener('input', event => { settings.pageWidth = Number(event.target.value); applyReaderSettings() })

  for (const eventName of ['dragenter', 'dragover']) {
    window.addEventListener(eventName, event => { event.preventDefault(); elements.dropZone.classList.add('dragging') })
  }
  for (const eventName of ['dragleave', 'drop']) {
    window.addEventListener(eventName, event => { event.preventDefault(); elements.dropZone.classList.remove('dragging') })
  }
  window.addEventListener('drop', event => {
    const [file] = event.dataTransfer.files
    if (file) openBook(file)
    else showToast('没有找到可打开的文件', 'error')
  })
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closePanels(); elements.selectionAiMenu.hidden = true; return }
    if (!document.body.classList.contains('is-reading') || elements.settingsPanel.classList.contains('open') || elements.toolsPanel.classList.contains('open')) return
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); navigate(-1) }
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); navigate(1) }
  })
}

applySettingsToControls()
bindControls()
renderLibrary()
