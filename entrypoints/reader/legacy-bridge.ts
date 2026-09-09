import type { Pinia } from 'pinia'
import type { EbookSessionPort } from './ebook-session-port'
import type { LegacyReaderCallbacks, LegacyReaderPort } from './legacy-reader-port'
import type { PdfSessionPort } from './pdf-session-port'
import { useReaderStore } from './stores/reader'
import { useSettingsStore } from './stores/settings'
import { useLibraryStore } from './stores/library'

export interface LegacyReaderBridge {
  callbacks: LegacyReaderCallbacks
  attachLegacyPort(port: LegacyReaderPort): void
  attachEbookPort(port: EbookSessionPort): void
  attachPdfPort(port: PdfSessionPort): void
  attachPort(port: LegacyReaderPort): void
  destroy(): void
}

export function connectLegacyReaderState(pinia: Pinia): LegacyReaderBridge {
  const store = useReaderStore(pinia)
  const settings = useSettingsStore(pinia)
  const library = useLibraryStore(pinia)
  let legacyPort: LegacyReaderPort | null = null
  let ebookPort: EbookSessionPort | null = null
  let pdfPort: PdfSessionPort | null = null

  return {
    callbacks: {
      onState: state => store.applyLegacyState(state),
      onPanelRequest: panel => store.requestPanel(panel),
      onLibraryChanged: () => library.load(),
    },
    attachLegacyPort(nextPort) {
      legacyPort = nextPort
      settings.attachPort(nextPort)
      library.attachLegacyPort(nextPort)
    },
    attachEbookPort(nextPort) {
      ebookPort = nextPort
      library.attachEbookPort(nextPort)
    },
    attachPdfPort(nextPort) {
      pdfPort = nextPort
      library.attachPdfPort(nextPort)
    },
    attachPort(nextPort) {
      legacyPort = nextPort
      settings.attachPort(nextPort)
      library.attachLegacyPort(nextPort)
    },
    destroy() {
      settings.attachPort(null)
      library.attachLegacyPort(null)
      library.attachEbookPort(null)
      library.attachPdfPort(null)
      legacyPort?.destroy()
      ebookPort?.destroy()
      pdfPort?.destroy()
      legacyPort = null
      ebookPort = null
      pdfPort = null
    },
  }
}
