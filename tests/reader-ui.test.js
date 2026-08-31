import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const ROOT_UI_LISTENERS = [
  ['header collapse', /elements\.headerToggle\.addEventListener\('click'/g],
  ['open button', /elements\.openButton\.addEventListener\('click'/g],
  ['hero open button', /elements\.heroOpenButton\.addEventListener\('click'/g],
  ['file input', /elements\.fileInput\.addEventListener\('change'/g],
  ['home button', /elements\.homeButton\.addEventListener\('click'/g],
  ['table of contents panel', /elements\.sidebarButton\.addEventListener\('click'/g],
  ['settings panel', /elements\.settingsButton\.addEventListener\('click'/g],
  ['tools panel', /elements\.toolsButton\.addEventListener\('click'/g],
  ['close settings', /elements\.closeSettings\.addEventListener\('click'/g],
  ['close tools', /elements\.closeTools\.addEventListener\('click'/g],
  ['panel scrim', /elements\.scrim\.addEventListener\('click'/g],
  ['library backup', /elements\.backupLibrary\.addEventListener\('click'/g],
  ['library restore picker', /elements\.restoreLibrary\.addEventListener\('click'/g],
  ['library restore file', /elements\.backupFileInput\.addEventListener\('change'/g],
  ['flow setting', /querySelectorAll\('\[data-flow\]'\)/g],
  ['theme setting', /querySelectorAll\('\[data-theme\]'\)/g],
  ['font setting', /elements\.fontSelect\.addEventListener\('change'/g],
  ['font size setting', /elements\.fontSize\.addEventListener\('input'/g],
  ['line height setting', /elements\.lineHeight\.addEventListener\('input'/g],
  ['page width setting', /elements\.pageWidth\.addEventListener\('input'/g],
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

test('root reader owns exactly one listener for every migrated UI action', async () => {
  const source = await readFile(new URL('../src/reader.js', import.meta.url), 'utf8')
  const rootBindings = functionSource(source, 'bindRootUiControls')
  const libraryRendering = functionSource(source, 'renderLibrary')

  for (const [action, pattern] of ROOT_UI_LISTENERS) {
    assert.equal(rootBindings.match(pattern)?.length || 0, 1, `${action} must have exactly one root listener`)
  }
  assert.equal(libraryRendering.match(/remove\.addEventListener\('click'/g)?.length || 0, 1, 'book deletion must have one root listener')
  assert.equal(libraryRendering.match(/card\.addEventListener\('click'/g)?.length || 0, 1, 'book opening must have one root click listener')
})

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist`)
  const bodyStart = source.indexOf('{', source.indexOf(') {', start))
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  assert.fail(`${name} must have a complete function body`)
}
