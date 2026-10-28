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

const panelInitialFocus = {
  toc: '#toc button:not(:disabled)',
  settings: '#close-settings',
  tools: '#search-input',
} as const

export function focusReaderPanel(panel: Exclude<ReaderPanel, null>) {
  const panelElement = document.getElementById(panel === 'toc' ? 'sidebar' : `${panel}-panel`)
  const target = panelElement?.querySelector<HTMLElement>(panelInitialFocus[panel]) ?? panelElement
  target?.focus({ preventScroll: true })
}

export function dismissReaderPanel(reader: PanelController) {
  const panel = reader.activePanel
  if (panel === null) return
  reader.closePanel()
  document.getElementById(panelTriggers[panel])?.focus({ preventScroll: true })
}

export function closePanelAndFocusReader(reader: PanelController) {
  reader.closePanel()
  document.getElementById('reader-stage')?.focus({ preventScroll: true })
}
