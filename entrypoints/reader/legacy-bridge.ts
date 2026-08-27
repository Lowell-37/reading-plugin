import type { Pinia } from 'pinia'
import type { LegacyReaderCallbacks, LegacyReaderPort } from './legacy-reader-port'
import { useReaderStore } from './stores/reader'

export interface LegacyReaderBridge {
  callbacks: LegacyReaderCallbacks
  attachPort(port: LegacyReaderPort): void
  destroy(): void
}

export function connectLegacyReaderState(pinia: Pinia): LegacyReaderBridge {
  const store = useReaderStore(pinia)
  let port: LegacyReaderPort | null = null

  return {
    callbacks: {
      onState: state => store.applyLegacyState(state),
      onPanelRequest: panel => store.requestPanel(panel),
      onLibraryChanged: () => undefined,
    },
    attachPort(nextPort) {
      port = nextPort
    },
    destroy() {
      port?.destroy()
      port = null
    },
  }
}
