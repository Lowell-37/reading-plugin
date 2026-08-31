import { defineStore } from 'pinia'
import type { EbookSessionSnapshot } from '../ebook-session-port'
import type { LegacyReaderState, ReaderPanel } from '../legacy-reader-port'

export const useReaderStore = defineStore('reader', {
  state: () => ({
    title: '未命名书籍',
    chapter: '开始',
    progress: 0,
    isReading: false,
    activePanel: null as 'toc' | 'settings' | 'tools' | null,
  }),
  actions: {
    applyLegacyState(state: Partial<LegacyReaderState>) {
      if (state.title !== undefined) this.title = state.title
      if (state.chapter !== undefined) this.chapter = state.chapter
      if (state.progress !== undefined) this.progress = state.progress
      if (state.isReading !== undefined) this.isReading = state.isReading
    },
    applyEbookSessionSnapshot(snapshot: EbookSessionSnapshot) {
      this.applyLegacyState({
        title: snapshot.title,
        chapter: snapshot.chapter,
        progress: snapshot.progress,
        isReading: snapshot.status === 'loading' || snapshot.status === 'ready',
      })
    },
    requestPanel(panel: ReaderPanel) {
      this.activePanel = panel
    },
    togglePanel(panel: Exclude<ReaderPanel, null>) {
      this.activePanel = this.activePanel === panel ? null : panel
    },
    closePanel() {
      this.activePanel = null
    },
  },
})
