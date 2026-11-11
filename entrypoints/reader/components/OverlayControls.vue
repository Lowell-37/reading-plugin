<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useReaderStore } from '../stores/reader'
import { useLibraryStore } from '../stores/library'
import { usePdfSessionStore } from '../stores/pdf-session'
import { dismissReaderPanel, trapReaderPanelFocus } from '../panel-focus'

const reader = useReaderStore()
const library = useLibraryStore()
const pdf = usePdfSessionStore()
const { activePanel } = storeToRefs(reader)
const pdfActive = computed(() => pdf.record !== null)
const pdfZoomPercent = computed(() => Math.round((Number(pdf.zoom) || 1) * 100))
let controlsMounted = false

function changePdfZoom(event: MouseEvent, delta: number) {
  if (!controlsMounted || !pdfActive.value) return
  event.stopImmediatePropagation()
  void pdf.setZoom(Math.round((Number(pdf.zoom) + delta) * 10) / 10)
}

function fitPdfWidth(event: MouseEvent) {
  if (!controlsMounted || !pdfActive.value) return
  event.stopImmediatePropagation()
  void pdf.setZoom(1)
}

function handleKeydown(event: KeyboardEvent) {
  if (reader.activePanel === null) return
  if (event.key === 'Tab' && (event.altKey || event.ctrlKey || event.metaKey)) return
  event.stopImmediatePropagation()
  if (event.key === 'Escape') dismissReaderPanel(reader)
  else trapReaderPanelFocus(reader.activePanel, event)
}

function clearSelectedFile(event: MouseEvent) {
  const input = event.currentTarget as HTMLInputElement
  input.value = ''
}

async function openSelectedFile(event: Event) {
  const input = event.target as HTMLInputElement
  const [file] = Array.from(input.files || [])
  if (file) await library.openFile(file).catch(console.error)
  input.value = ''
}

onMounted(() => {
  controlsMounted = true
  window.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
  controlsMounted = false
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div id="selection-ai-menu" class="selection-ai-menu" role="toolbar" aria-label="划词 AI" hidden>
    <span>AI</span><button type="button" data-ai-scope="selection" data-ai-action="explain">解释</button><button type="button" data-ai-scope="selection" data-ai-action="translate">翻译</button><button type="button" data-ai-scope="selection" data-ai-action="simplify">简化</button><button type="button" data-ai-scope="selection" data-ai-action="terms">术语</button><button type="button" data-ai-scope="selection" data-ai-action="background">背景</button><button id="close-selection-ai-menu" class="selection-ai-close" type="button" aria-label="关闭划词 AI">×</button>
  </div>
  <div id="pdf-toolbar" class="pdf-toolbar" role="group" aria-label="PDF 缩放" :hidden="!pdfActive">
    <button id="pdf-zoom-out" type="button" aria-label="缩小" aria-controls="pdf-viewport" @click.capture="changePdfZoom($event, -0.1)">−</button><span id="pdf-zoom-label" role="status" aria-live="polite" aria-atomic="true" aria-label="PDF 缩放比例">{{ pdfZoomPercent }}%</span><button id="pdf-zoom-in" type="button" aria-label="放大" aria-controls="pdf-viewport" @click.capture="changePdfZoom($event, 0.1)">＋</button><button id="pdf-fit-width" type="button" aria-controls="pdf-viewport" @click.capture="fitPdfWidth">适合宽度</button>
  </div>
  <div id="scrim" class="scrim" :class="{ show: activePanel !== null }" @click="dismissReaderPanel(reader)" /><div id="toast" class="toast" role="status" />
  <input id="file-input" type="file" accept=".pdf,.epub,.mobi,.azw3,application/pdf,application/epub+zip,application/x-mobipocket-ebook" hidden @click="clearSelectedFile" @change="openSelectedFile">
</template>
