function listener(action, target, event, kind = 'element') {
  return Object.freeze({ action, target, event, kind })
}

export const ENGINE_LISTENERS = Object.freeze([
  listener('loading-return-library', 'loadingLibraryButton', 'click'),
  listener('loading-retry-file', 'loadingRetryButton', 'click'),
  listener('ai-settings-toggle', 'aiSettingsToggle', 'click'),
  listener('ai-settings-save', 'saveAiSettings', 'click'),
  listener('ai-stop', 'aiStop', 'click'),
  listener('ai-selection-close', 'closeSelectionAiMenu', 'click'),
  listener('ai-action', 'aiActionButtons', 'click', 'collection'),
  listener('search-submit', 'searchForm', 'submit'),
  listener('annotation-highlight', 'highlightSelection', 'click'),
  listener('annotation-note', 'noteSelection', 'click'),
  listener('annotation-filter-query', 'annotationFilterQuery', 'input'),
  listener('annotation-filter-type', 'annotationFilterType', 'change'),
  listener('annotation-sort', 'annotationSort', 'change'),
  listener('annotation-select-all', 'annotationSelectAll', 'click'),
  listener('annotation-delete-selected', 'annotationDeleteSelected', 'click'),
  listener('annotation-import-picker', 'importAnnotationsJson', 'click'),
  listener('annotation-import-file', 'annotationImportInput', 'change'),
  listener('annotation-export-markdown', 'exportAnnotationsMarkdown', 'click'),
  listener('annotation-export-json', 'exportAnnotationsJson', 'click'),
  listener('reader-prev', 'prevButton', 'click'),
  listener('reader-next', 'nextButton', 'click'),
  listener('pdf-zoom-out', 'pdfZoomOut', 'click'),
  listener('pdf-zoom-in', 'pdfZoomIn', 'click'),
  listener('pdf-fit-width', 'pdfFitWidth', 'click'),
  listener('pdf-page-change', 'pdfPageInput', 'change'),
  listener('pdf-page-keyboard', 'pdfPageInput', 'keydown'),
  listener('reader-progress', 'progressSlider', 'input'),
  listener('reader-keyboard', 'window', 'keydown', 'window'),
])

export const ROOT_EBOOK_LISTENERS = Object.freeze([
  listener('reader-prev', 'prevButton', 'click'),
  listener('reader-next', 'nextButton', 'click'),
  listener('reader-progress', 'progressSlider', 'input'),
  listener('reader-keyboard', 'window', 'keydown', 'window'),
])

const ROOT_EBOOK_ACTIONS = new Set(ROOT_EBOOK_LISTENERS.map(binding => binding.action))
const ROOT_PDF_ACTIONS = new Set([
  'pdf-zoom-out', 'pdf-zoom-in', 'pdf-fit-width', 'pdf-page-change', 'pdf-page-keyboard',
])

export const WXT_ENGINE_LISTENERS = Object.freeze(
  ENGINE_LISTENERS.filter(binding => !ROOT_EBOOK_ACTIONS.has(binding.action) && !ROOT_PDF_ACTIONS.has(binding.action)),
)

export const ROOT_UI_LISTENERS = Object.freeze([
  listener('open-button', 'openButton', 'click'),
  listener('hero-open-button', 'heroOpenButton', 'click'),
  listener('file-input', 'fileInput', 'change'),
  listener('home-button', 'homeButton', 'click'),
  listener('header-collapse', 'headerToggle', 'click'),
  listener('panel-toc', 'sidebarButton', 'click'),
  listener('panel-settings', 'settingsButton', 'click'),
  listener('panel-tools', 'toolsButton', 'click'),
  listener('panel-close-settings', 'closeSettings', 'click'),
  listener('panel-close-tools', 'closeTools', 'click'),
  listener('panel-scrim', 'scrim', 'click'),
  listener('library-backup', 'backupLibrary', 'click'),
  listener('library-restore-picker', 'restoreLibrary', 'click'),
  listener('library-restore-file', 'backupFileInput', 'change'),
  listener('settings-flow', '[data-flow]', 'click', 'selector'),
  listener('settings-theme', '[data-theme]', 'click', 'selector'),
  listener('settings-font', 'fontSelect', 'change'),
  listener('settings-font-size', 'fontSize', 'input'),
  listener('settings-line-height', 'lineHeight', 'input'),
  listener('settings-page-width', 'pageWidth', 'input'),
  listener('file-dragenter', 'window', 'dragenter', 'window'),
  listener('file-dragover', 'window', 'dragover', 'window'),
  listener('file-dragleave', 'window', 'dragleave', 'window'),
  listener('file-drop', 'window', 'drop', 'window'),
  listener('panel-escape', 'window', 'keydown', 'window'),
])

export const ROOT_LIBRARY_LISTENERS = Object.freeze([
  listener('library-card-open', 'card', 'click'),
  listener('library-card-keyboard', 'card', 'keydown'),
  listener('library-card-delete', 'remove', 'click'),
])

export const LISTENER_STARTUP = Object.freeze({
  wxt: Object.freeze(['engine']),
  root: Object.freeze(['engine', 'rootUi', 'rootLibrary']),
})

export function bindRegisteredListeners(bindings, handlers, resolveTargets) {
  for (const binding of bindings) {
    const handler = handlers[binding.action]
    if (typeof handler !== 'function') throw new Error(`Missing reader listener handler: ${binding.action}`)
    const targets = resolveTargets(binding)
    for (const target of targets) {
      if (!target) throw new Error(`Missing reader listener target: ${binding.target}`)
      target.addEventListener(binding.event, handler)
    }
  }
}

export function startReaderListenerMode(mode, initializers) {
  const steps = LISTENER_STARTUP[mode]
  if (!steps) throw new Error(`Unknown reader listener mode: ${mode}`)
  for (const step of steps) {
    const initialize = initializers[step]
    if (typeof initialize !== 'function') throw new Error(`Missing reader listener initializer: ${step}`)
    initialize()
  }
}
