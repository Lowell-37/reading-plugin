import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const EXPECTED_ROOT_UI_LISTENERS = [
  'open-button@openButton:click',
  'hero-open-button@heroOpenButton:click',
  'file-input@fileInput:change',
  'home-button@homeButton:click',
  'header-collapse@headerToggle:click',
  'panel-toc@sidebarButton:click',
  'panel-settings@settingsButton:click',
  'panel-tools@toolsButton:click',
  'panel-close-settings@closeSettings:click',
  'panel-close-tools@closeTools:click',
  'panel-scrim@scrim:click',
  'library-backup@backupLibrary:click',
  'library-restore-picker@restoreLibrary:click',
  'library-restore-file@backupFileInput:change',
  'settings-flow@[data-flow]:click',
  'settings-theme@[data-theme]:click',
  'settings-font@fontSelect:change',
  'settings-font-size@fontSize:input',
  'settings-line-height@lineHeight:input',
  'settings-page-width@pageWidth:input',
  'file-dragenter@window:dragenter',
  'file-dragover@window:dragover',
  'file-dragleave@window:dragleave',
  'file-drop@window:drop',
  'panel-escape@window:keydown',
]

const EXPECTED_ROOT_LIBRARY_LISTENERS = [
  'library-card-open@card:click',
  'library-card-keyboard@card:keydown',
  'library-card-delete@remove:click',
]

const EXPECTED_ROOT_EBOOK_LISTENERS = [
  'reader-prev@prevButton:click',
  'reader-next@nextButton:click',
  'reader-progress@progressSlider:input',
  'reader-keyboard@window:keydown',
]

test('reader exposes search, annotation and PDF navigation controls', async () => {
  const html = await readFile(new URL('../reader.html', import.meta.url), 'utf8')
  for (const id of ['header-toggle', 'tools-button', 'search-form', 'highlight-selection', 'note-selection', 'annotation-filter-query', 'annotation-filter-type', 'annotation-sort', 'annotation-select-all', 'annotation-delete-selected', 'import-annotations-json', 'annotation-import-input', 'export-annotations-markdown', 'export-annotations-json', 'ai-settings', 'ai-result', 'selection-ai-menu', 'pdf-toolbar', 'pdf-page-input']) {
    assert.match(html, new RegExp(`id=["']${id}["']`))
  }
  const meta = html.match(/Content-Security-Policy[^>]+content="([^"]+)"/)?.[1] || ''
  const workerSource = meta.split(';').find(part => part.trim().startsWith('worker-src')) || ''
  assert.doesNotMatch(workerSource, /blob:/)
})

test('scrolled EPUB mode uses a continuous cross-chapter document flow', async () => {
  const source = await readFile(new URL('../src/reader.js', import.meta.url), 'utf8')
  const controller = await readFile(new URL('../src/continuous-ebook.js', import.meta.url), 'utf8')
  const css = await readFile(new URL('../styles/reader.css', import.meta.url), 'utf8')
  assert.match(source, /new ContinuousEbookScroller/)
  assert.match(source, /continuousEbook\.mount/)
  assert.doesNotMatch(source, /SectionBoundaryNavigator/)
  assert.match(controller, /IntersectionObserver/)
  assert.match(controller, /continuous-section-frame/)
  assert.match(css, /\.continuous-ebook\s*\{[^}]*overflow-y:auto/)
})
test('manifest and package versions stay aligned', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.version, pkg.version)
})
test('root and Vue library shells expose versioned backup and restore controls', async () => {
  const html = await readFile(new URL('../reader.html', import.meta.url), 'utf8')
  const vue = await readFile(new URL('../entrypoints/reader/components/WelcomeLibrary.vue', import.meta.url), 'utf8')
  const source = await readFile(new URL('../src/reader.js', import.meta.url), 'utf8')
  for (const id of ['backup-library', 'restore-library', 'backup-file-input', 'backup-status']) {
    const pattern = new RegExp(`id=["']${id}["']`)
    assert.match(html, pattern)
    assert.match(vue, pattern)
  }
  assert.match(source, /createLibraryBackup/)
  assert.match(source, /parseLibraryBackup/)
})

test('root startup retains ebook listeners while WXT startup excludes them', async () => {
  const ownership = await import('../src/reader-listener-registry.js').catch(() => null)
  assert.ok(ownership, 'reader listener ownership must be represented by an importable production registry')

  assert.deepEqual(signatures(ownership.ROOT_UI_LISTENERS), EXPECTED_ROOT_UI_LISTENERS)
  assert.deepEqual(signatures(ownership.ROOT_LIBRARY_LISTENERS), EXPECTED_ROOT_LIBRARY_LISTENERS)
  assert.deepEqual(signatures(ownership.ROOT_EBOOK_LISTENERS), EXPECTED_ROOT_EBOOK_LISTENERS)
  assert.deepEqual(ownership.LISTENER_STARTUP.wxt, ['engine'])
  assert.deepEqual(ownership.LISTENER_STARTUP.root, ['engine', 'rootUi', 'rootLibrary'])
  assert.deepEqual(
    ownership.WXT_ENGINE_LISTENERS.filter(binding => EXPECTED_ROOT_EBOOK_LISTENERS
      .some(signature => signature.startsWith(`${binding.action}@`))),
    [],
  )

  const allBindings = [
    ...ownership.ENGINE_LISTENERS,
    ...ownership.ROOT_UI_LISTENERS,
    ...ownership.ROOT_LIBRARY_LISTENERS,
  ]
  assert.equal(new Set(allBindings.map(binding => binding.action)).size, allBindings.length)
  assert.deepEqual(
    signatures(ownership.ROOT_UI_LISTENERS.filter(binding => binding.target === 'window')),
    EXPECTED_ROOT_UI_LISTENERS.filter(signature => signature.includes('@window:')),
  )

  assert.equal(typeof ownership.bindRegisteredListeners, 'function')
  const registrations = []
  const handlers = Object.fromEntries(allBindings.map(binding => [binding.action, () => undefined]))
  ownership.bindRegisteredListeners(allBindings, handlers, binding => [{
    addEventListener(event, handler) {
      registrations.push(`${binding.action}@${binding.target}:${event}`)
      assert.equal(handler, handlers[binding.action])
    },
  }])
  assert.deepEqual(registrations, signatures(allBindings))

  const started = []
  ownership.startReaderListenerMode('root', {
    engine: () => started.push('engine'),
    rootUi: () => started.push('rootUi'),
    rootLibrary: () => started.push('rootLibrary'),
  })
  assert.deepEqual(started, ['engine', 'rootUi', 'rootLibrary'])
})

function signatures(bindings) {
  return bindings.map(binding => `${binding.action}@${binding.target}:${binding.event}`)
}
