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

watch(workspaceVisible, visible => {
  document.body.classList.toggle('is-reading', visible)
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
    document.getElementById('loading-title')?.replaceChildren('正在打开书籍')
    document.getElementById('loading-detail')?.replaceChildren('解析内容与目录…')
    const loadingActions = document.getElementById('loading-actions') as HTMLElement | null
    if (loadingActions) loadingActions.hidden = true
  }
  if (nextStatus === 'error') {
    loadingView?.setAttribute('data-state', 'error')
    document.getElementById('loading-title')?.replaceChildren(nextError?.title || '无法打开这本书')
    document.getElementById('loading-detail')?.replaceChildren(nextError?.detail || '无法打开电子书。请重新选择文件后重试。')
    const loadingActions = document.getElementById('loading-actions') as HTMLElement | null
    if (loadingActions) loadingActions.hidden = false
  }
}

function syncEbookFooter(active: boolean) {
  if (!active) return
  const normalizedProgress = Math.max(0, Math.min(1, Number(progress.value) || 0))
  const progressText = `${Math.round(normalizedProgress * 100)}%`
  const progressSlider = document.getElementById('progress-slider') as HTMLInputElement | null
  const progressLabel = document.getElementById('progress-label')
  document.getElementById('chapter-label')?.replaceChildren(chapter.value)
  if (progressSlider) progressSlider.value = String(normalizedProgress)
  progressLabel?.replaceChildren(progressText)
}

function syncPdfControls(active: boolean) {
  const pageJump = document.getElementById('pdf-page-jump') as HTMLElement | null
  const toolbar = document.getElementById('pdf-toolbar') as HTMLElement | null
  pageJump?.toggleAttribute('hidden', !active)
  toolbar?.toggleAttribute('hidden', !active)
  if (!active) return
  const page = Math.max(1, Math.round(Number(pdfPage.value) || 1))
  const pageCount = Math.max(1, Math.round(Number(pdfPageCount.value) || 1))
  const normalizedProgress = Math.max(0, Math.min(1, Number(pdfProgress.value) || 0))
  const input = document.getElementById('pdf-page-input') as HTMLInputElement | null
  if (input) {
    input.value = String(page)
    input.max = String(pageCount)
  }
  document.getElementById('pdf-page-total')?.replaceChildren(`/ ${pageCount}`)
  document.getElementById('chapter-label')?.replaceChildren(`第 ${page} 页 / 共 ${pageCount} 页`)
  const slider = document.getElementById('progress-slider') as HTMLInputElement | null
  if (slider) slider.value = String(normalizedProgress)
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
    document.getElementById(id)?.addEventListener('click', event => {
      if (!pdfSessionActive.value) return
      event.stopImmediatePropagation()
      listener(event)
    })
  }
  window.addEventListener('keydown', handlePdfKeyboard)
})

onBeforeUnmount(() => {
  document.body.classList.remove('is-reading', 'pdf-mode')
  window.removeEventListener('keydown', handlePdfKeyboard)
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

function seekPdfProgress(event: Event) {
  if (!pdfSessionActive.value) return
  event.stopImmediatePropagation()
  const fraction = Math.max(0, Math.min(1, Number((event.currentTarget as HTMLInputElement).value) || 0))
  const pageCount = Math.max(1, Math.round(Number(pdfPageCount.value) || 1))
  void pdf.goTo(Math.round(fraction * (pageCount - 1)) + 1)
}

function stepPdfZoom(delta: number) {
  return Math.round((Number(pdfZoom.value) + delta) * 10) / 10
}

function handlePdfKeyboard(event: KeyboardEvent) {
  if (!pdfSessionActive.value) return
  event.stopImmediatePropagation()
  const activeTagName = document.activeElement?.tagName ?? ''
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTagName)) return
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); void pdf.navigate(-1) }
  if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); void pdf.navigate(1) }
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
    <div id="reader-stage" class="reader-stage">
      <div id="loading-view" class="loading-view">
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
      <input id="progress-slider" type="range" min="0" max="1" step="any" value="0" aria-label="阅读进度" @input="seekPdfProgress">
      <div class="footer-status">
        <div id="pdf-page-jump" class="pdf-page-jump" hidden>
          <input id="pdf-page-input" type="number" min="1" value="1" aria-label="跳转页码" @change="jumpToPdfPage" @keydown="jumpToPdfPageOnEnter"><span id="pdf-page-total">/ 1</span>
        </div>
        <span id="progress-label">0%</span>
      </div>
    </footer>
  </main>
</template>
