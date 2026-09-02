<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import TocSidebar from './TocSidebar.vue'
import { useEbookSessionStore } from '../stores/ebook-session'
import { useReaderStore } from '../stores/reader'
import { useSettingsStore } from '../stores/settings'

const reader = useReaderStore()
const settings = useSettingsStore()
const ebook = useEbookSessionStore()
const { isReading, chapter, progress } = storeToRefs(reader)
const { record, flow, status } = storeToRefs(ebook)
const ebookSessionActive = computed(() => record.value !== null)

watch(() => settings.flow, nextFlow => {
  if (ebookSessionActive.value && flow.value !== nextFlow) void ebook.setFlow(nextFlow)
})

watch(isReading, reading => {
  document.body.classList.toggle('is-reading', reading)
  document.getElementById('welcome-view')?.toggleAttribute('hidden', reading)
}, { immediate: true })

function syncEbookHost(active: boolean) {
  document.getElementById('ebook-host')?.toggleAttribute('hidden', !active)
  document.getElementById('pdf-viewport')?.toggleAttribute('hidden', active)
}

function syncEbookLoadingView(active: boolean, nextStatus: typeof status.value) {
  if (!active) return
  document.getElementById('loading-view')?.toggleAttribute('hidden', nextStatus !== 'loading')
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

watch(ebookSessionActive, syncEbookHost, { immediate: true })
watch([ebookSessionActive, status], ([active, nextStatus]) => syncEbookLoadingView(active, nextStatus), { immediate: true })
watch([ebookSessionActive, chapter, progress], ([active]) => syncEbookFooter(active), { immediate: true })
onMounted(() => {
  syncEbookHost(ebookSessionActive.value)
  syncEbookLoadingView(ebookSessionActive.value, status.value)
  syncEbookFooter(ebookSessionActive.value)
})

onBeforeUnmount(() => document.body.classList.remove('is-reading'))

function navigate(event: MouseEvent, direction: -1 | 1) {
  if (!ebookSessionActive.value) return
  event.stopImmediatePropagation()
  void ebook.navigate(direction)
}
</script>

<template>
  <main id="reader-view" class="reader-view" :class="{ 'ebook-session-active': ebookSessionActive }" :hidden="!isReading">
    <TocSidebar />
    <div id="reader-stage" class="reader-stage">
      <div id="loading-view" class="loading-view">
        <div id="loading-spinner" class="spinner" /><strong id="loading-title">正在打开书籍</strong><span id="loading-detail">解析内容与目录…</span>
        <div id="loading-actions" class="loading-actions" hidden>
          <button id="loading-library-button" class="soft-button" type="button">返回书架</button>
          <button id="loading-retry-button" class="primary-button" type="button">重新选择文件</button>
        </div>
      </div>
      <div id="ebook-host" class="ebook-host" />
      <div id="pdf-viewport" class="pdf-viewport"><div id="pdf-pages" class="pdf-pages" /></div>
      <button id="prev-button" class="page-zone page-zone-left" aria-label="上一页" @click="navigate($event, -1)"><span>‹</span></button>
      <button id="next-button" class="page-zone page-zone-right" aria-label="下一页" @click="navigate($event, 1)"><span>›</span></button>
    </div>
    <footer class="reader-footer">
      <span id="chapter-label">开始</span>
      <input id="progress-slider" type="range" min="0" max="1" step="any" value="0" aria-label="阅读进度">
      <div class="footer-status">
        <div id="pdf-page-jump" class="pdf-page-jump" hidden>
          <input id="pdf-page-input" type="number" min="1" value="1" aria-label="跳转页码"><span id="pdf-page-total">/ 1</span>
        </div>
        <span id="progress-label">0%</span>
      </div>
    </footer>
  </main>
</template>
