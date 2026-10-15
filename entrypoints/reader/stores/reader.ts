import { defineStore } from 'pinia'
import type { EbookSessionSnapshot } from '../ebook-session-port'
import type { PdfSessionSnapshot } from '../pdf-session-port'
import type { ReaderPanel } from '../legacy-reader-port'

interface ReaderRuntimeState {
  title: string
  chapter: string
  progress: number
  isReading: boolean
}

export const useReaderStore = defineStore('reader', {
  state: () => ({
    title: '未命名书籍',
    chapter: '开始',
    progress: 0,
    isReading: false,
    activePanel: null as 'toc' | 'settings' | 'tools' | null,
  }),
  actions: {
    applyReaderState(state: Partial<ReaderRuntimeState>) {
      if (state.title !== undefined) this.title = state.title
      if (state.chapter !== undefined) this.chapter = state.chapter
      if (state.progress !== undefined) this.progress = state.progress
      if (state.isReading !== undefined) this.isReading = state.isReading
    },
    applyEbookSessionSnapshot(snapshot: EbookSessionSnapshot) {
      this.applyReaderState({
        title: snapshot.title,
        chapter: snapshot.chapter,
        progress: snapshot.progress,
        isReading: snapshot.status === 'loading' || snapshot.status === 'ready',
      })
    },
    applyPdfSessionSnapshot(snapshot: PdfSessionSnapshot) {
      this.applyReaderState({
        title: snapshot.title,
        chapter: `第 ${snapshot.page} 页 / 共 ${snapshot.pageCount} 页`,
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
