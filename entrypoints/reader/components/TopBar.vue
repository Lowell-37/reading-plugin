<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useReaderStore } from '../stores/reader'

const { title } = storeToRefs(useReaderStore())
</script>

<template>
  <header id="app-header" class="app-header">
    <div class="header-left">
      <button id="sidebar-button" class="icon-button reader-only" aria-label="打开目录" title="目录">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <button id="home-button" class="brand" title="返回书架">
        <span class="brand-mark">静</span><span class="brand-name">静读</span>
      </button>
      <div class="book-heading reader-only">
        <span class="header-divider" /><span id="header-title">{{ title }}</span>
      </div>
    </div>
    <div class="header-actions">
      <span class="privacy-note welcome-only">文件仅保存在此浏览器中</span>
      <button id="open-button" class="soft-button">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5M5 20h14" /></svg>打开书籍
      </button>
      <button id="tools-button" class="icon-button header-icon-button reader-only" aria-label="搜索、AI与批注" title="搜索、AI与批注">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
      </button>
      <button id="settings-button" class="icon-button header-icon-button reader-only" aria-label="阅读设置" title="阅读设置">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
      </button>
    </div>
  </header>
  <button id="header-toggle" class="header-toggle reader-only" type="button" aria-expanded="true" aria-label="收起顶部栏" title="收起顶部栏">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg>
  </button>
</template>
