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

const panelIds = {
  toc: 'sidebar',
  settings: 'settings-panel',
  tools: 'tools-panel',
} as const

const panelInitialFocus = {
  toc: '#toc button:not(:disabled)',
  settings: '#close-settings',
  tools: '#search-input',
} as const

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getPanelElement(panel: Exclude<ReaderPanel, null>) {
  return document.getElementById(panelIds[panel])
}

function isVisibleInPanel(element: HTMLElement, panel: HTMLElement) {
  let current: HTMLElement | null = element
  while (current) {
    if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false
    if (current === panel) break
    current = current.parentElement
  }
  return element.tabIndex >= 0
}

function getFocusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => !element.matches(':disabled') && isVisibleInPanel(element, panel))
}

export function focusReaderPanel(panel: Exclude<ReaderPanel, null>) {
  const panelElement = getPanelElement(panel)
  const target = panelElement?.querySelector<HTMLElement>(panelInitialFocus[panel]) ?? panelElement
  target?.focus({ preventScroll: true })
}

export function trapReaderPanelFocus(panel: Exclude<ReaderPanel, null>, event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
  const panelElement = getPanelElement(panel)
  if (!panelElement) return
  const focusable = getFocusableElements(panelElement)
  const first = focusable[0] ?? panelElement
  const last = focusable.at(-1) ?? panelElement
  const active = document.activeElement
  const focusEscaped = !active || !panelElement.contains(active)
  const target = focusEscaped
    ? (event.shiftKey ? last : first)
    : event.shiftKey && active === first
      ? last
      : !event.shiftKey && active === last
        ? first
        : null
  if (!target) return
  event.preventDefault()
  target.focus({ preventScroll: true })
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
