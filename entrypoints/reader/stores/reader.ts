import { defineStore } from 'pinia'

export const useReaderStore = defineStore('reader', {
  state: () => ({
    title: '未命名书籍',
    chapter: '开始',
    progress: 0,
    isReading: false,
    activePanel: null as 'toc' | 'settings' | 'tools' | null,
  }),
  actions: {
    syncFromDom() {
      this.title = document.querySelector('#header-title')?.textContent || '未命名书籍'
      this.chapter = document.querySelector('#chapter-label')?.textContent || '开始'
      this.progress = Number((document.querySelector('#progress-slider') as HTMLInputElement | null)?.value || 0)
      this.isReading = document.body.classList.contains('is-reading')
      this.activePanel = document.querySelector('#sidebar.open')
        ? 'toc'
        : document.querySelector('#settings-panel.open')
          ? 'settings'
          : document.querySelector('#tools-panel.open')
            ? 'tools'
            : null
    },
  },
})
