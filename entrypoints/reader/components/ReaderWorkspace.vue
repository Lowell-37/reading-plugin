<script setup lang="ts">
import TocSidebar from './TocSidebar.vue'
</script>

<template>
  <main id="reader-view" class="reader-view" hidden>
    <TocSidebar />
    <div id="reader-stage" class="reader-stage">
      <div id="loading-view" class="loading-view">
        <div class="spinner" /><strong>正在打开书籍</strong><span id="loading-detail">解析内容与目录…</span>
      </div>
      <div id="ebook-host" class="ebook-host" />
      <div id="pdf-viewport" class="pdf-viewport"><div id="pdf-pages" class="pdf-pages" /></div>
      <button id="prev-button" class="page-zone page-zone-left" aria-label="上一页"><span>‹</span></button>
      <button id="next-button" class="page-zone page-zone-right" aria-label="下一页"><span>›</span></button>
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
