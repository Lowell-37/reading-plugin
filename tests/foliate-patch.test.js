import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Foliate patch supports XHTML bodies and safe sandboxing', async () => {
  const paginator = await readFile(new URL('../node_modules/foliate-js/paginator.js', import.meta.url), 'utf8')
  assert.match(paginator, /const getBody = doc => doc\?\.body/)
  assert.match(paginator, /if \(!el\?\.style\) return/)
  assert.match(paginator, /setAttribute\('sandbox', 'allow-same-origin'\)/)
  assert.doesNotMatch(paginator, /allow-same-origin allow-scripts/)
  assert.match(paginator, /this\.#iframe\.srcdoc = html/)
})

test('Foliate patch normalizes legacy Chinese language tags', async () => {
  const view = await readFile(new URL('../node_modules/foliate-js/view.js', import.meta.url), 'utf8')
  assert.match(view, /replace\(\/\^zh-cmn/)
  assert.match(view, /getCanonicalLocales\(normalizeLanguageTag\(lang\)\)/)
})
