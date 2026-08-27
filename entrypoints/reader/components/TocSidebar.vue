<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useReaderStore } from '../stores/reader'

const { activePanel } = storeToRefs(useReaderStore())
</script>

<template>
  <aside id="sidebar" class="sidebar" :class="{ open: activePanel === 'toc' }" aria-label="书籍目录">
    <div class="sidebar-book">
      <div id="sidebar-cover" class="cover-placeholder"><span id="cover-letter">静</span></div>
      <div class="sidebar-meta">
        <strong id="sidebar-title">未命名书籍</strong><span id="sidebar-author">未知作者</span><small id="sidebar-format">EPUB</small>
      </div>
    </div>
    <div class="sidebar-label"><span>目录</span><span id="toc-count" /></div>
    <nav id="toc" class="toc" />
  </aside>
</template>
