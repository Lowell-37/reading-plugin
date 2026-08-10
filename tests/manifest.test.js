import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('pins the extension identity so browser storage survives path changes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  assert.match(manifest.key, /^MIIB/)
})

test('allows blob EPUB frames without allowing blob workers', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  const csp = manifest.content_security_policy.extension_pages
  const frameSource = csp.split(';').find(part => part.trim().startsWith('frame-src')) || ''
  const workerSource = csp.split(';').find(part => part.trim().startsWith('worker-src')) || ''
  assert.match(frameSource, /\bblob:/)
  assert.doesNotMatch(workerSource, /\bblob:/)
})
