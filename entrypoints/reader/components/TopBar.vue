<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useReaderStore } from '../stores/reader'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { useEbookSessionStore } from '../stores/ebook-session'

const reader = useReaderStore()
const settings = useSettingsStore()
const library = useLibraryStore()
const ebook = useEbookSessionStore()
const { title } = storeToRefs(reader)
const { headerCollapsed } = storeToRefs(settings)

function openFilePicker() {
  document.getElementById('file-input')?.click()
}

async function closeReader() {
  reader.closePanel()
  if (ebook.record) {
    await ebook.close()
    await library.load()
    return
  }
  await library.closeSession()
}
</script>

<template>
  <header id="app-header" class="app-header">
    <div class="header-left">
      <button id="sidebar-button" class="icon-button reader-only" aria-label="打开目录" title="目录" @click="reader.togglePanel('toc')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <button id="home-button" class="brand" title="返回书架" @click="closeReader().catch(console.error)">
        <span class="brand-mark">静</span><span class="brand-name">静读</span>
      </button>
      <div class="book-heading reader-only">
        <span class="header-divider" /><span id="header-title">{{ title }}</span>
      </div>
    </div>
    <div class="header-actions">
      <span class="privacy-note welcome-only">文件仅保存在此浏览器中</span>
      <label id="open-button" class="soft-button" for="file-input" role="button" tabindex="0" @keydown.enter.prevent="openFilePicker" @keydown.space.prevent="openFilePicker">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5M5 20h14" /></svg>打开书籍
      </label>
      <button id="tools-button" class="icon-button header-icon-button reader-only" aria-label="搜索与批注" title="搜索与批注" @click="reader.togglePanel('tools')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
      </button>
      <button id="settings-button" class="icon-button header-icon-button reader-only" aria-label="阅读设置" title="阅读设置" @click="reader.togglePanel('settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
      </button>
    </div>
  </header>
  <button
    id="header-toggle"
    class="header-toggle reader-only"
    type="button"
    :aria-expanded="!headerCollapsed"
    :aria-label="headerCollapsed ? '展开顶部栏' : '收起顶部栏'"
    :title="headerCollapsed ? '展开顶部栏' : '收起顶部栏'"
    @click="settings.toggleHeaderCollapsed()"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg>
  </button>
</template>
