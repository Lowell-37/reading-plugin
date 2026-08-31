import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const EXPECTED_ENGINE_LISTENERS = [
  'loading-return-library@loadingLibraryButton:click',
  'loading-retry-file@loadingRetryButton:click',
  'ai-settings-toggle@aiSettingsToggle:click',
  'ai-settings-save@saveAiSettings:click',
  'ai-stop@aiStop:click',
  'ai-selection-close@closeSelectionAiMenu:click',
  'ai-action@aiActionButtons:click',
  'search-submit@searchForm:submit',
  'annotation-highlight@highlightSelection:click',
  'annotation-note@noteSelection:click',
  'annotation-filter-query@annotationFilterQuery:input',
  'annotation-filter-type@annotationFilterType:change',
  'annotation-sort@annotationSort:change',
  'annotation-select-all@annotationSelectAll:click',
  'annotation-delete-selected@annotationDeleteSelected:click',
  'annotation-import-picker@importAnnotationsJson:click',
  'annotation-import-file@annotationImportInput:change',
  'annotation-export-markdown@exportAnnotationsMarkdown:click',
  'annotation-export-json@exportAnnotationsJson:click',
  'reader-prev@prevButton:click',
  'reader-next@nextButton:click',
  'pdf-zoom-out@pdfZoomOut:click',
  'pdf-zoom-in@pdfZoomIn:click',
  'pdf-fit-width@pdfFitWidth:click',
  'pdf-page-change@pdfPageInput:change',
  'pdf-page-keyboard@pdfPageInput:keydown',
  'reader-progress@progressSlider:input',
  'reader-keyboard@window:keydown',
]

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

test('WXT startup owns the exhaustive engine inventory and no migrated UI action', async () => {
  const ownership = await import('../src/reader-listener-registry.js').catch(() => null)
  assert.ok(ownership, 'reader listener ownership must be represented by an importable production registry')

  assert.deepEqual(signatures(ownership.ENGINE_LISTENERS), EXPECTED_ENGINE_LISTENERS)
  assert.deepEqual(ownership.LISTENER_STARTUP.wxt, ['engine'])
  const migratedActions = new Set([
    ...ownership.ROOT_UI_LISTENERS,
    ...ownership.ROOT_LIBRARY_LISTENERS,
  ].map(binding => binding.action))
  assert.deepEqual(ownership.ENGINE_LISTENERS.filter(binding => migratedActions.has(binding.action)), [])

  const started = []
  ownership.startReaderListenerMode('wxt', {
    engine: () => started.push('engine'),
    rootUi: () => started.push('rootUi'),
    rootLibrary: () => started.push('rootLibrary'),
  })
  assert.deepEqual(started, ['engine'])
})

function signatures(bindings) {
  return bindings.map(binding => `${binding.action}@${binding.target}:${binding.event}`)
}
