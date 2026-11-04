<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import TocSidebar from './TocSidebar.vue'
import { useEbookSessionStore } from '../stores/ebook-session'
import { useLibraryStore } from '../stores/library'
import { usePdfSessionStore } from '../stores/pdf-session'
import { useReaderStore } from '../stores/reader'
import { useSettingsStore } from '../stores/settings'

const reader = useReaderStore()
const settings = useSettingsStore()
const ebook = useEbookSessionStore()
const pdf = usePdfSessionStore()
const library = useLibraryStore()
const { isReading, chapter, progress } = storeToRefs(reader)
const { record, status, error } = storeToRefs(ebook)
const {
  record: pdfRecord,
  status: pdfStatus,
  error: pdfError,
  page: pdfPage,
  pageCount: pdfPageCount,
  progress: pdfProgress,
  zoom: pdfZoom,
} = storeToRefs(pdf)
const ebookSessionActive = computed(() => record.value !== null)
const pdfSessionActive = computed(() => pdfRecord.value !== null)
const ebookErrorActive = computed(() => ebookSessionActive.value && status.value === 'error')
const pdfErrorActive = computed(() => pdfSessionActive.value && pdfStatus.value === 'error')
const workspaceVisible = computed(() => isReading.value || ebookErrorActive.value || pdfErrorActive.value)
const pdfToolbarListeners: Array<{ element: HTMLElement, handler: EventListener }> = []

watch(workspaceVisible, visible => {
  document.body.classList.toggle('is-reading', visible)
  document.body.classList.toggle('header-collapsed', visible && settings.headerCollapsed)
  document.getElementById('welcome-view')?.toggleAttribute('hidden', visible)
}, { immediate: true })

function syncSessionHosts(ebookActive: boolean, pdfActive: boolean) {
  document.getElementById('ebook-host')?.toggleAttribute('hidden', !ebookActive)
  document.getElementById('pdf-viewport')?.toggleAttribute('hidden', !pdfActive)
  document.body.classList.toggle('pdf-mode', pdfActive)
}

function syncLoadingView(
  ebookActive: boolean,
  pdfActive: boolean,
  nextEbookStatus: typeof status.value,
  nextPdfStatus: typeof pdfStatus.value,
  nextEbookError: typeof error.value,
  nextPdfError: typeof pdfError.value,
) {
  if (!ebookActive && !pdfActive) return
  const nextStatus = pdfActive ? nextPdfStatus : nextEbookStatus
  const nextError = pdfActive ? nextPdfError : nextEbookError
  const loadingView = document.getElementById('loading-view')
  loadingView?.toggleAttribute('hidden', nextStatus !== 'loading' && nextStatus !== 'error')
  if (nextStatus === 'loading') {
    loadingView?.setAttribute('data-state', 'loading')
    loadingView?.setAttribute('role', 'status')
    loadingView?.setAttribute('aria-live', 'polite')
    document.getElementById('loading-title')?.replaceChildren('正在打开书籍')
    document.getElementById('loading-detail')?.replaceChildren('解析内容与目录…')
    const loadingActions = document.getElementById('loading-actions') as HTMLElement | null
    if (loadingActions) loadingActions.hidden = true
  }
  if (nextStatus === 'error') {
    loadingView?.setAttribute('data-state', 'error')
    loadingView?.setAttribute('role', 'alert')
    loadingView?.setAttribute('aria-live', 'assertive')
    document.getElementById('loading-title')?.replaceChildren(nextError?.title || '无法打开这本书')
    document.getElementById('loading-detail')?.replaceChildren(nextError?.detail || '无法打开电子书。请重新选择文件后重试。')
    const loadingActions = document.getElementById('loading-actions') as HTMLElement | null
    if (loadingActions) loadingActions.hidden = false
  }
}

function syncEbookFooter(active: boolean) {
  const progressSlider = document.getElementById('progress-slider') as HTMLInputElement | null
  if (!active) {
    if (!pdfSessionActive.value) progressSlider?.removeAttribute('aria-valuetext')
    return
  }
  const normalizedProgress = Math.max(0, Math.min(1, Number(progress.value) || 0))
  const progressText = `${Math.round(normalizedProgress * 100)}%`
  const progressLabel = document.getElementById('progress-label')
  document.getElementById('chapter-label')?.replaceChildren(chapter.value)
  if (progressSlider) {
    progressSlider.value = String(normalizedProgress)
    progressSlider.setAttribute('aria-valuetext', `${progressText}，${chapter.value}`)
  }
  progressLabel?.replaceChildren(progressText)
}

function syncPdfControls(active: boolean) {
  const pageJump = document.getElementById('pdf-page-jump') as HTMLElement | null
  const toolbar = document.getElementById('pdf-toolbar') as HTMLElement | null
  const slider = document.getElementById('progress-slider') as HTMLInputElement | null
  pageJump?.toggleAttribute('hidden', !active)
  toolbar?.toggleAttribute('hidden', !active)
  if (!active) {
    if (!ebookSessionActive.value) slider?.removeAttribute('aria-valuetext')
    return
  }
  const page = Math.max(1, Math.round(Number(pdfPage.value) || 1))
  const pageCount = Math.max(1, Math.round(Number(pdfPageCount.value) || 1))
  const normalizedProgress = Math.max(0, Math.min(1, Number(pdfProgress.value) || 0))
  const input = document.getElementById('pdf-page-input') as HTMLInputElement | null
  if (input) {
    input.value = String(page)
    input.max = String(pageCount)
    input.setAttribute('aria-valuetext', `第 ${page} 页，共 ${pageCount} 页`)
  }
  const pageTotal = document.getElementById('pdf-page-total')
  const pageTotalText = `/ ${pageCount}`
  const pageTotalLabel = `共 ${pageCount} 页`
  if (pageTotal?.textContent !== pageTotalText) pageTotal?.replaceChildren(pageTotalText)
  if (pageTotal?.getAttribute('aria-label') !== pageTotalLabel) pageTotal?.setAttribute('aria-label', pageTotalLabel)
  document.getElementById('chapter-label')?.replaceChildren(`第 ${page} 页 / 共 ${pageCount} 页`)
  if (slider) {
    slider.value = String(normalizedProgress)
    slider.setAttribute('aria-valuetext', `${Math.round(normalizedProgress * 100)}%，第 ${page} 页，共 ${pageCount} 页`)
  }
  document.getElementById('progress-label')?.replaceChildren(`${Math.round(normalizedProgress * 100)}%`)
  document.getElementById('pdf-zoom-label')?.replaceChildren(`${Math.round((Number(pdfZoom.value) || 1) * 100)}%`)
}

watch([ebookSessionActive, pdfSessionActive], ([ebookActive, pdfActive]) => syncSessionHosts(ebookActive, pdfActive), { immediate: true })
watch(
  [ebookSessionActive, pdfSessionActive, status, pdfStatus, error, pdfError],
  ([ebookActive, pdfActive, nextEbookStatus, nextPdfStatus, nextEbookError, nextPdfError]) => syncLoadingView(
    ebookActive, pdfActive, nextEbookStatus, nextPdfStatus, nextEbookError, nextPdfError,
  ),
  { immediate: true },
)
watch([ebookSessionActive, chapter, progress], ([active]) => syncEbookFooter(active), { immediate: true })
watch([pdfSessionActive, pdfPage, pdfPageCount, pdfProgress, pdfZoom], ([active]) => syncPdfControls(active), { immediate: true })
onMounted(() => {
  syncSessionHosts(ebookSessionActive.value, pdfSessionActive.value)
  syncLoadingView(ebookSessionActive.value, pdfSessionActive.value, status.value, pdfStatus.value, error.value, pdfError.value)
  syncEbookFooter(ebookSessionActive.value)
  syncPdfControls(pdfSessionActive.value)
  const controls: Array<[string, EventListener]> = [
    ['pdf-zoom-out', () => { if (pdfSessionActive.value) void pdf.setZoom(stepPdfZoom(-0.1)) }],
    ['pdf-zoom-in', () => { if (pdfSessionActive.value) void pdf.setZoom(stepPdfZoom(0.1)) }],
    ['pdf-fit-width', () => { if (pdfSessionActive.value) void pdf.setZoom(1) }],
  ]
  for (const [id, listener] of controls) {
    const element = document.getElementById(id)
    if (!element) continue
    const handler: EventListener = event => {
      if (!pdfSessionActive.value) return
      event.stopImmediatePropagation()
      listener(event)
    }
    element.addEventListener('click', handler)
    pdfToolbarListeners.push({ element, handler })
  }
  window.addEventListener('keydown', handleReaderKeyboard)
})

onBeforeUnmount(() => {
  document.body.classList.remove('is-reading', 'pdf-mode', 'header-collapsed')
  window.removeEventListener('keydown', handleReaderKeyboard)
  for (const { element, handler } of pdfToolbarListeners) element.removeEventListener('click', handler)
  pdfToolbarListeners.length = 0
})

function navigate(event: MouseEvent, direction: -1 | 1) {
  if (pdfSessionActive.value) {
    event.stopImmediatePropagation()
    void pdf.navigate(direction)
    return
  }
  if (!ebookSessionActive.value) return
  event.stopImmediatePropagation()
  void ebook.navigate(direction)
}

function jumpToPdfPage(event: Event) {
  if (!pdfSessionActive.value) return
  event.stopImmediatePropagation()
  const input = event.currentTarget as HTMLInputElement
  void pdf.goTo(Number(input.value))
}

function jumpToPdfPageOnEnter(event: KeyboardEvent) {
  if (!pdfSessionActive.value || event.key !== 'Enter') return
  event.preventDefault()
  jumpToPdfPage(event)
}

function seekProgress(event: Event) {
  if (!pdfSessionActive.value && !ebookSessionActive.value) return
  event.stopImmediatePropagation()
  const fraction = Math.max(0, Math.min(1, Number((event.currentTarget as HTMLInputElement).value) || 0))
  if (ebookSessionActive.value) {
    void ebook.goTo({ fraction })
    return
  }
  const pageCount = Math.max(1, Math.round(Number(pdfPageCount.value) || 1))
  void pdf.goTo(Math.round(fraction * (pageCount - 1)) + 1)
}

function stepPdfZoom(delta: number) {
  return Math.round((Number(pdfZoom.value) + delta) * 10) / 10
}

function hasEditableFocus(root: Document | ShadowRoot = document): boolean {
  const activeElement = root.activeElement
  if (!activeElement) return false
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName)) return true
  const contentEditable = activeElement.getAttribute('contenteditable')
  if (activeElement instanceof HTMLElement && (activeElement.isContentEditable || (contentEditable !== null && contentEditable.toLowerCase() !== 'false'))) return true
  if (activeElement instanceof HTMLIFrameElement) {
    try {
      return activeElement.contentDocument ? hasEditableFocus(activeElement.contentDocument) : false
    } catch {
      return false
    }
  }
  return activeElement instanceof HTMLElement && activeElement.shadowRoot
    ? hasEditableFocus(activeElement.shadowRoot)
    : false
}

function handleReaderKeyboard(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  if (!workspaceVisible.value || reader.activePanel !== null || (!pdfSessionActive.value && !ebookSessionActive.value)) return
  if (hasEditableFocus()) return
  const direction = event.key === 'ArrowLeft' || event.key === 'PageUp'
    ? -1
    : event.key === 'ArrowRight' || event.key === 'PageDown'
      ? 1
      : null
  if (direction === null) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (pdfSessionActive.value) void pdf.navigate(direction)
  else void ebook.navigate(direction)
}

async function recoverSessionError(event: MouseEvent, retry: boolean) {
  if (!ebookErrorActive.value && !pdfErrorActive.value) return
  event.stopImmediatePropagation()
  reader.closePanel()
  if (pdfErrorActive.value) await pdf.close()
  else await ebook.close()
  await library.load()
  if (retry) document.getElementById('file-input')?.click()
}
</script>

<template>
  <main id="reader-view" class="reader-view" :class="{ 'ebook-session-active': ebookSessionActive, 'pdf-session-active': pdfSessionActive }" :hidden="!workspaceVisible">
    <TocSidebar />
    <div id="reader-stage" class="reader-stage" role="region" aria-label="阅读内容" tabindex="-1">
      <div id="loading-view" class="loading-view" role="status" aria-live="polite" aria-atomic="true" aria-labelledby="loading-title" aria-describedby="loading-detail">
        <div id="loading-spinner" class="spinner" /><strong id="loading-title">正在打开书籍</strong><span id="loading-detail">解析内容与目录…</span>
        <div id="loading-actions" class="loading-actions" hidden>
          <button id="loading-library-button" class="soft-button" type="button" @click.capture="recoverSessionError($event, false).catch(console.error)">返回书架</button>
          <button id="loading-retry-button" class="primary-button" type="button" @click.capture="recoverSessionError($event, true).catch(console.error)">重新选择文件</button>
        </div>
      </div>
      <div id="ebook-host" class="ebook-host" />
      <div id="pdf-viewport" class="pdf-viewport"><div id="pdf-pages" class="pdf-pages" /></div>
      <button id="prev-button" class="page-zone page-zone-left" aria-label="上一页" @click="navigate($event, -1)"><span>‹</span></button>
      <button id="next-button" class="page-zone page-zone-right" aria-label="下一页" @click="navigate($event, 1)"><span>›</span></button>
    </div>
    <footer class="reader-footer">
      <span id="chapter-label">开始</span>
      <input id="progress-slider" type="range" min="0" max="1" step="any" value="0" aria-label="阅读进度" @input="seekProgress">
      <div class="footer-status">
        <div id="pdf-page-jump" class="pdf-page-jump" role="group" aria-label="PDF 页码跳转" hidden>
          <input id="pdf-page-input" type="number" min="1" value="1" aria-label="跳转页码" aria-controls="pdf-viewport" aria-describedby="pdf-page-total" @change="jumpToPdfPage" @keydown="jumpToPdfPageOnEnter"><span id="pdf-page-total" role="status" aria-live="polite" aria-atomic="true" aria-label="共 1 页">/ 1</span>
        </div>
        <span id="progress-label">0%</span>
      </div>
    </footer>
  </main>
</template>
