<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, ref, watch } from 'vue'
import type { BookRecord } from '../../../src/core/types'
import { displayValue, formatBytes } from '../../../src/core/formats'
import { useLibraryStore } from '../stores/library'

const library = useLibraryStore()
const { books, backupState, backupStatus } = storeToRefs(library)
const backupInput = ref<HTMLInputElement | null>(null)
const coverUrls = ref<Record<string, string>>({})
const dragging = ref(false)

function revokeCovers() {
  for (const url of Object.values(coverUrls.value)) URL.revokeObjectURL(url)
  coverUrls.value = {}
}

watch(books, records => {
  revokeCovers()
  coverUrls.value = Object.fromEntries(records.flatMap(record => record.cover
    ? [[record.id, URL.createObjectURL(record.cover)]]
    : []))
}, { immediate: true })

onBeforeUnmount(revokeCovers)

function title(record: BookRecord) {
  return displayValue(record.metadata?.title) || record.name.replace(/\.[^.]+$/, '')
}

function author(record: BookRecord) {
  return displayValue(record.metadata?.author) || '未知作者'
}

function progress(record: BookRecord) {
  return Math.round((record.progress?.fraction || 0) * 100)
}

function openFilePicker() {
  document.getElementById('file-input')?.click()
}

async function handleDrop(event: DragEvent) {
  dragging.value = false
  const [file] = Array.from(event.dataTransfer?.files || [])
  if (file) await library.openFile(file).catch(console.error)
}

function openBackupPicker() {
  if (!backupInput.value) return
  backupInput.value.value = ''
  backupInput.value.click()
}

async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const [file] = Array.from(input.files || [])
  if (file) await library.restore(file).catch(console.error)
  input.value = ''
}
</script>

<template>
  <main id="welcome-view" class="welcome-view">
    <section
      id="drop-zone"
      class="hero"
      :class="{ dragging }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="handleDrop"
    >
      <div class="hero-art" aria-hidden="true">
        <div class="book book-back" /><div class="book book-front"><span>静</span></div>
      </div>
      <p class="eyebrow">LOCAL-FIRST READER</p>
      <h1>把书交给浏览器，<br><em>把注意力留给阅读。</em></h1>
      <p class="hero-copy">打开 PDF、EPUB、MOBI 或 AZW3。无需上传，无需注册，阅读进度安静地留在本机。</p>
      <label id="hero-open-button" class="primary-button" for="file-input" role="button" tabindex="0" @keydown.enter.prevent="openFilePicker" @keydown.space.prevent="openFilePicker">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" /></svg>
        选择一本书
      </label>
      <p class="drop-hint">也可以直接拖到这里</p>
      <div class="format-row"><span>PDF</span><span>EPUB</span><span>MOBI</span><span>AZW3</span></div>
      <div class="library-backup-actions" aria-label="书库备份与恢复">
        <button id="backup-library" class="soft-button" type="button" :disabled="backupState === 'working'" @click="library.backup().catch(console.error)">备份书库</button>
        <button id="restore-library" class="soft-button" type="button" :disabled="backupState === 'working'" @click="openBackupPicker">恢复备份</button>
        <span id="backup-status" aria-live="polite" :data-state="backupState">{{ backupStatus }}</span>
      </div>
      <input ref="backupInput" id="backup-file-input" type="file" accept=".quietreader,application/vnd.quiet-reader.backup" hidden @change="restoreBackup">
    </section>
    <section id="library-section" class="library-section" :hidden="books.length === 0">
      <div class="section-heading">
        <div><p class="eyebrow">YOUR LIBRARY</p><h2>最近阅读</h2></div><p>点击书籍，继续上次的位置</p>
      </div>
      <div id="book-grid" class="book-grid">
        <article
          v-for="record in books"
          :key="record.id"
          class="library-card"
          tabindex="0"
          @click="library.openRecord(record).catch(console.error)"
          @keydown.enter.prevent="library.openRecord(record).catch(console.error)"
          @keydown.space.prevent="library.openRecord(record).catch(console.error)"
        >
          <div class="mini-cover">
            <img v-if="coverUrls[record.id]" :src="coverUrls[record.id]" :alt="`${title(record)}封面`">
            <template v-else>{{ title(record).slice(0, 1) || '书' }}</template>
          </div>
          <div class="card-info">
            <div class="card-title">{{ title(record) }}</div>
            <div class="card-author">{{ author(record) }}</div>
            <div class="card-meta">{{ record.format.toUpperCase() }} · {{ formatBytes(record.size) }}</div>
            <div class="card-progress" :aria-label="`阅读进度 ${progress(record)}%`"><span :style="{ width: `${progress(record)}%` }" /></div>
          </div>
          <button class="delete-book" type="button" aria-label="从书架移除" @click.stop="library.remove(record.id).catch(console.error)">×</button>
        </article>
      </div>
    </section>
  </main>
</template>
