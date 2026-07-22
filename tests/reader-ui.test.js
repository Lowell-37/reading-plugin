import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('reader exposes search, annotation and PDF navigation controls', async () => {
  const html = await readFile(new URL('../reader.html', import.meta.url), 'utf8')
  for (const id of ['tools-button', 'search-form', 'highlight-selection', 'note-selection', 'pdf-toolbar', 'pdf-page-input']) {
    assert.match(html, new RegExp(`id=["']${id}["']`))
  }
  const meta = html.match(/Content-Security-Policy[^>]+content="([^"]+)"/)?.[1] || ''
  const workerSource = meta.split(';').find(part => part.trim().startsWith('worker-src')) || ''
  assert.doesNotMatch(workerSource, /blob:/)
})

test('manifest and package versions stay aligned', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.version, pkg.version)
})