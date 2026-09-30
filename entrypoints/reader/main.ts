import { createPinia } from 'pinia'
import { createApp, nextTick, watch } from 'vue'
import '../../styles/reader.css'
import App from './App.vue'
// @ts-expect-error JavaScript compatibility repository has no declaration file yet.
import { bookRepository } from '../../src/book-repository.js'
// @ts-expect-error JavaScript compatibility progress service has no declaration file yet.
import { ProgressService } from '../../src/progress-service.js'
import { createFoliateEbookSessionDependencies } from './ebook-session-dependencies'
import { createFoliateEbookSession } from './foliate-ebook-session'
import { connectLegacyReaderState } from './legacy-bridge'
import type { LegacyReaderPort } from './legacy-reader-port'
import { createPdfSessionDependencies } from './pdf-session-dependencies'
import { createPdfJsSession } from './pdfjs-session'
import { runMigrationPreflight } from './migration-preflight'
import { useMigrationStore } from './stores/migration'
import { useLibraryStore } from './stores/library'
import { useEbookSessionStore } from './stores/ebook-session'
import { usePdfSessionStore } from './stores/pdf-session'
import { usePdfAnnotationStore } from './stores/pdf-annotations'

interface ExtensionRuntime {
  getURL(path: string): string
}

async function startReader() {
  const pinia = createPinia()
  createApp(App).use(pinia).mount('#app')
  await nextTick()
  const migration = useMigrationStore(pinia)
  const preflight = await runMigrationPreflight()
  document.documentElement.dataset.migrationPreflight = preflight.ok ? 'ready' : 'failed'
  if (!preflight.ok) {
    migration.fail(preflight.error)
    await nextTick()
  }
  if (!preflight.ok) return
  migration.ready()
  const library = useLibraryStore(pinia)
  await library.load()
  const bridge = connectLegacyReaderState(pinia)
  const ebookSession = useEbookSessionStore(pinia)
  const pdfSession = usePdfSessionStore(pinia)
  const pdfAnnotations = usePdfAnnotationStore(pinia)
  const ebookHost = document.getElementById('ebook-host')
  if (!ebookHost) throw new Error('Ebook session host is unavailable')
  const pdfViewport = document.getElementById('pdf-viewport')
  const pdfPages = document.getElementById('pdf-pages')
  if (!pdfViewport || !pdfPages) throw new Error('PDF session host is unavailable')
  let ebookGeneration = 0
  ebookSession.attachPort(callbacks => createFoliateEbookSession(createFoliateEbookSessionDependencies({
    ...callbacks,
    host: ebookHost,
    createProgressService: () => new ProgressService(bookRepository),
    nextGeneration: () => ++ebookGeneration,
  })))
  let pdfGeneration = 0
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: ExtensionRuntime } }).chrome?.runtime
  pdfSession.attachPort(callbacks => createPdfJsSession(createPdfSessionDependencies({
    ...callbacks,
    baseUrl: runtime?.getURL
      ? runtime.getURL('node_modules/pdfjs-dist/')
      : new URL('../../node_modules/pdfjs-dist/', import.meta.url).href,
    host: { viewport: pdfViewport, pages: pdfPages },
    createObserver: callback => new IntersectionObserver(callback, { root: pdfViewport, rootMargin: '900px 0px' }),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: handle => cancelAnimationFrame(handle),
    pixelRatio: () => window.devicePixelRatio,
    createProgressService: () => new ProgressService(bookRepository),
    nextGeneration: () => ++pdfGeneration,
  })))
  const stopPdfAnnotationSync = watch(
    [() => pdfSession.record, () => pdfSession.generation, () => pdfSession.zoom, () => pdfSession.status],
    ([sessionRecord, generation, zoom, status]) => {
      const record = status === 'ready' ? library.books.find(book => book.id === sessionRecord?.id) ?? null : null
      pdfAnnotations.synchronizeSession({ record, generation, zoom, root: document.getElementById('pdf-pages') })
    },
    { immediate: true, flush: 'sync' },
  )
  pdfSession.onPageRendered((page, renderedGeneration) => {
    if (renderedGeneration === pdfAnnotations.generation) pdfAnnotations.renderPage(page)
  })
  document.documentElement.dataset.legacyController = 'loading'
  // The imperative controller remains JavaScript until its engine adapters move to TypeScript.
  // @ts-expect-error JavaScript compatibility controller has no declaration file yet.
  const legacyReader = await import('../../src/reader.js')
  const port: LegacyReaderPort = legacyReader.createLegacyReaderPort(bridge.callbacks)
  watch([() => pdfSession.generation, () => pdfSession.status], () => {
    const record = pdfSession.status === 'ready'
      ? library.books.find(book => book.id === pdfSession.record?.id)
      : null
    port.attachPdfTools?.(record ? {
      id: record.id, name: record.name, format: record.format,
      metadata: record.metadata, annotations: record.annotations,
    } : null, record ? {
      pageCount: () => pdfSession.pageCount,
      readTextLayer: page => pdfSession.readRenderedTextLayer(page),
      goTo: page => pdfSession.goTo(page),
    } : undefined)
  }, { flush: 'sync' })
  bridge.attachLegacyPort(port)
  bridge.attachEbookPort(ebookSession)
  bridge.attachPdfPort(pdfSession)
  document.documentElement.dataset.legacyController = 'ready'
}

await startReader()
