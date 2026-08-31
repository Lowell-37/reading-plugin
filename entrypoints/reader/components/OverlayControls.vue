<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted } from 'vue'
import { useReaderStore } from '../stores/reader'
import { useLibraryStore } from '../stores/library'

const reader = useReaderStore()
const library = useLibraryStore()
const { activePanel } = storeToRefs(reader)

function handleKeydown(event: KeyboardEvent) {
  if (reader.activePanel === null) return
  event.stopImmediatePropagation()
  if (event.key === 'Escape') reader.closePanel()
}

async function openSelectedFile(event: Event) {
  const input = event.target as HTMLInputElement
  const [file] = Array.from(input.files || [])
  if (file) await library.openFile(file).catch(console.error)
  input.value = ''
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div id="selection-ai-menu" class="selection-ai-menu" role="toolbar" aria-label="划词 AI" hidden>
    <span>AI</span><button type="button" data-ai-scope="selection" data-ai-action="explain">解释</button><button type="button" data-ai-scope="selection" data-ai-action="translate">翻译</button><button type="button" data-ai-scope="selection" data-ai-action="simplify">简化</button><button type="button" data-ai-scope="selection" data-ai-action="terms">术语</button><button type="button" data-ai-scope="selection" data-ai-action="background">背景</button><button id="close-selection-ai-menu" class="selection-ai-close" type="button" aria-label="关闭划词 AI">×</button>
  </div>
  <div id="pdf-toolbar" class="pdf-toolbar" hidden>
    <button id="pdf-zoom-out" type="button" aria-label="缩小">−</button><span id="pdf-zoom-label">100%</span><button id="pdf-zoom-in" type="button" aria-label="放大">＋</button><button id="pdf-fit-width" type="button">适合宽度</button>
  </div>
  <div id="scrim" class="scrim" :class="{ show: activePanel !== null }" @click="reader.closePanel()" /><div id="toast" class="toast" role="status" />
  <input id="file-input" type="file" accept=".pdf,.epub,.mobi,.azw3,application/pdf,application/epub+zip,application/x-mobipocket-ebook" hidden @change="openSelectedFile">
</template>
