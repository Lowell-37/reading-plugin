<template>
  <main id="welcome-view" class="welcome-view">
    <section id="drop-zone" class="hero">
      <div class="hero-art" aria-hidden="true">
        <div class="book book-back" /><div class="book book-front"><span>静</span></div>
      </div>
      <p class="eyebrow">LOCAL-FIRST READER</p>
      <h1>把书交给浏览器，<br><em>把注意力留给阅读。</em></h1>
      <p class="hero-copy">打开 PDF、EPUB、MOBI 或 AZW3。无需上传，无需注册，阅读进度安静地留在本机。</p>
      <button id="hero-open-button" class="primary-button">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" /></svg>
        选择一本书
      </button>
      <p class="drop-hint">也可以直接拖到这里</p>
      <div class="format-row"><span>PDF</span><span>EPUB</span><span>MOBI</span><span>AZW3</span></div>
      <div class="library-backup-actions" aria-label="书库备份与恢复">
        <button id="backup-library" class="soft-button" type="button">备份书库</button>
        <button id="restore-library" class="soft-button" type="button">恢复备份</button>
        <span id="backup-status" aria-live="polite">备份包含书籍、进度、高亮、批注和设置，不包含 API 密钥</span>
      </div>
      <input id="backup-file-input" type="file" accept=".quietreader,application/vnd.quiet-reader.backup" hidden>
    </section>
    <section id="library-section" class="library-section" hidden>
      <div class="section-heading">
        <div><p class="eyebrow">YOUR LIBRARY</p><h2>最近阅读</h2></div><p>点击书籍，继续上次的位置</p>
      </div>
      <div id="book-grid" class="book-grid" />
    </section>
  </main>
</template>
