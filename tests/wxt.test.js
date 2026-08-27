import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('WXT owns the background and reader entrypoints', async () => {
  const [config, background, reader, pkg] = await Promise.all([
    readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../entrypoints/reader/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  assert.match(config, /permissions:\s*\['storage'\]/)
  assert.match(config, /worker-src 'self'/)
  assert.doesNotMatch(config, /worker-src\s+'self'\s+blob:/)
  assert.match(background, /getURL\('\/reader\.html'\)/)
  assert.match(reader, /src="\.\/main\.ts"/)
  assert.equal(pkg.scripts.build, 'npm run sync:assets && wxt build')
})

test('WXT asset sync preserves PDF.js runtime paths', async () => {
  const source = await readFile(new URL('../scripts/sync-public-assets.mjs', import.meta.url), 'utf8')
  for (const path of ['pdf.worker.min.mjs', 'cmaps', 'standard_fonts', 'wasm']) {
    assert.match(source, new RegExp(path.replace('.', '\\.')))
  }
})

test('WXT completes the read-only migration preflight before loading the legacy controller', async () => {
  const source = await readFile(new URL('../entrypoints/reader/main.ts', import.meta.url), 'utf8')
  const preflight = source.indexOf('await runMigrationPreflight')
  const legacyImport = source.indexOf("await import('../../src/reader.js')")
  assert.ok(preflight >= 0, 'WXT reader entrypoint must run the migration preflight')
  assert.ok(legacyImport > preflight, 'legacy controller must load only after the preflight')
  assert.match(source, /if \(!preflight\.ok\) return/)
})
