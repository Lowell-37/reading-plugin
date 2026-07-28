import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('reader exposes search, annotation and PDF navigation controls', async () => {
  const html = await readFile(new URL('../reader.html', import.meta.url), 'utf8')
  for (const id of ['header-toggle', 'tools-button', 'search-form', 'highlight-selection', 'note-selection', 'ai-settings', 'ai-result', 'selection-ai-menu', 'pdf-toolbar', 'pdf-page-input']) {
    assert.match(html, new RegExp(`id=["']${id}["']`))
  }
  const meta = html.match(/Content-Security-Policy[^>]+content="([^"]+)"/)?.[1] || ''
  const workerSource = meta.split(';').find(part => part.trim().startsWith('worker-src')) || ''
  assert.doesNotMatch(workerSource, /blob:/)
})

test('EPUB and PDF selections are connected to the AI selection menu', async () => {
  const source = await readFile(new URL('../src/reader.js', import.meta.url), 'utf8')
  assert.match(source, /pendingSelection = \{ kind: 'ebook'[\s\S]+?updateAiSelectionUi\(\)/)
  assert.match(source, /pendingSelection = \{ kind: 'pdf'[\s\S]+?updateAiSelectionUi\(\)/)
  assert.match(source, /getCurrentChapterContext[\s\S]+?section\.createDocument\(\)/)
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