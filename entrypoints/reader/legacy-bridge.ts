import type { Pinia } from 'pinia'
import type { LegacyReaderCallbacks, LegacyReaderPort } from './legacy-reader-port'
import { useReaderStore } from './stores/reader'
import { useSettingsStore } from './stores/settings'

export interface LegacyReaderBridge {
  callbacks: LegacyReaderCallbacks
  attachPort(port: LegacyReaderPort): void
  destroy(): void
}

export function connectLegacyReaderState(pinia: Pinia): LegacyReaderBridge {
  const store = useReaderStore(pinia)
  const settings = useSettingsStore(pinia)
  let port: LegacyReaderPort | null = null

  return {
    callbacks: {
      onState: state => store.applyLegacyState(state),
      onPanelRequest: panel => store.requestPanel(panel),
      onLibraryChanged: () => undefined,
    },
    attachPort(nextPort) {
      port = nextPort
      settings.attachPort(nextPort)
    },
    destroy() {
      settings.attachPort(null)
      port?.destroy()
      port = null
    },
  }
}
