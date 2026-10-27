import type { ReaderPanel } from './reader-types'

interface PanelController {
  activePanel: ReaderPanel
  closePanel(): void
}

const panelTriggers = {
  toc: 'sidebar-button',
  settings: 'settings-button',
  tools: 'tools-button',
} as const

export function dismissReaderPanel(reader: PanelController) {
  const panel = reader.activePanel
  if (panel === null) return
  reader.closePanel()
  document.getElementById(panelTriggers[panel])?.focus({ preventScroll: true })
}
