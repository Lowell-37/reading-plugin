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
const workspaceLoading = computed(() => (ebookSessionActive.value && status.value === 'loading')
  || (pdfSessionActive.value && pdfStatus.value === 'loading'))
const activeViewportId = computed(() => pdfSessionActive.value ? 'pdf-viewport' : 'ebook-host')
const activeStatus = computed(() => pdfSessionActive.value
  ? pdfStatus.value
  : ebookSessionActive.value ? status.value : 'idle')
const activeError = computed(() => pdfSessionActive.value ? pdfError.value : error.value)
const loadingVisible = computed(() => activeStatus.value === 'loading' || activeStatus.value === 'error')
const loadingIsError = computed(() => activeStatus.value === 'error')
const loadingTitle = computed(() => loadingIsError.value
  ? activeError.value?.title || '无法打开这本书'
  : '正在打开书籍')
const loadingDetail = computed(() => loadingIsError.value
  ? activeError.value?.detail || '无法打开电子书。请重新选择文件后重试。'
  : '解析内容与目录…')
const pdfPageNumber = computed(() => Math.max(1, Math.round(Number(pdfPage.value) || 1)))
const pdfPageCountNumber = computed(() => Math.max(1, Math.round(Number(pdfPageCount.value) || 1)))
const footerProgress = computed(() => {
  const value = pdfSessionActive.value ? pdfProgress.value : ebookSessionActive.value ? progress.value : 0
  return Math.max(0, Math.min(1, Number(value) || 0))
})
const footerProgressPercent = computed(() => Math.round(footerProgress.value * 100))
const footerChapter = computed(() => pdfSessionActive.value
  ? `第 ${pdfPageNumber.value} 页 / 共 ${pdfPageCountNumber.value} 页`
  : ebookSessionActive.value ? chapter.value : '开始')
const progressValueText = computed(() => {
  if (pdfSessionActive.value) return `${footerProgressPercent.value}%，第 ${pdfPageNumber.value} 页，共 ${pdfPageCountNumber.value} 页`
  if (ebookSessionActive.value) return `${footerProgressPercent.value}%，${chapter.value}`
  return undefined
})

watch(workspaceVisible, visible => {
  document.body.classList.toggle('is-reading', visible)
  document.body.classList.toggle('header-collapsed', visible && settings.headerCollapsed)
}, { immediate: true })

watch(pdfSessionActive, active => document.body.classList.toggle('pdf-mode', active), { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', handleReaderKeyboard)
})

onBeforeUnmount(() => {
  document.body.classList.remove('is-reading', 'pdf-mode', 'header-collapsed')
  window.removeEventListener('keydown', handleReaderKeyboard)
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
    <div id="reader-stage" class="reader-stage" role="region" aria-label="阅读内容" aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown" :aria-busy="workspaceLoading ? 'true' : undefined" tabindex="-1">
      <div id="loading-view" class="loading-view" :hidden="!loadingVisible" :data-state="loadingIsError ? 'error' : activeStatus === 'loading' ? 'loading' : undefined" :role="loadingIsError ? 'alert' : 'status'" :aria-live="loadingIsError ? 'assertive' : 'polite'" aria-atomic="true" aria-labelledby="loading-title" aria-describedby="loading-detail">
        <div id="loading-spinner" class="spinner" /><strong id="loading-title">{{ loadingTitle }}</strong><span id="loading-detail">{{ loadingDetail }}</span>
        <div id="loading-actions" class="loading-actions" :hidden="!loadingIsError">
          <button id="loading-library-button" class="soft-button" type="button" @click.capture="recoverSessionError($event, false).catch(console.error)">返回书架</button>
          <button id="loading-retry-button" class="primary-button" type="button" @click.capture="recoverSessionError($event, true).catch(console.error)">重新选择文件</button>
        </div>
      </div>
      <div id="ebook-host" class="ebook-host" :hidden="!ebookSessionActive" />
      <div id="pdf-viewport" class="pdf-viewport" :hidden="!pdfSessionActive"><div id="pdf-pages" class="pdf-pages" /></div>
      <button id="prev-button" class="page-zone page-zone-left" aria-label="上一页" :aria-controls="activeViewportId" aria-keyshortcuts="ArrowLeft PageUp" @click="navigate($event, -1)"><span>‹</span></button>
      <button id="next-button" class="page-zone page-zone-right" aria-label="下一页" :aria-controls="activeViewportId" aria-keyshortcuts="ArrowRight PageDown" @click="navigate($event, 1)"><span>›</span></button>
    </div>
    <footer class="reader-footer">
      <span id="chapter-label">{{ footerChapter }}</span>
      <input id="progress-slider" type="range" min="0" max="1" step="any" :value="footerProgress" aria-label="阅读进度" :aria-valuetext="progressValueText" @input="seekProgress">
      <div class="footer-status">
        <div id="pdf-page-jump" class="pdf-page-jump" role="group" aria-label="PDF 页码跳转" :hidden="!pdfSessionActive">
          <input id="pdf-page-input" type="number" min="1" :max="pdfPageCountNumber" :value="pdfPageNumber" aria-label="跳转页码" aria-controls="pdf-viewport" aria-describedby="pdf-page-total" :aria-valuetext="`第 ${pdfPageNumber} 页，共 ${pdfPageCountNumber} 页`" @change="jumpToPdfPage" @keydown="jumpToPdfPageOnEnter"><span id="pdf-page-total" role="status" aria-live="polite" aria-atomic="true" :aria-label="`共 ${pdfPageCountNumber} 页`">/ {{ pdfPageCountNumber }}</span>
        </div>
        <span id="progress-label">{{ footerProgressPercent }}%</span>
      </div>
    </footer>
  </main>
</template>
