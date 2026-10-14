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
import { createPdfSessionDependencies } from './pdf-session-dependencies'
import { createPdfJsSession } from './pdfjs-session'
import { runMigrationPreflight } from './migration-preflight'
import { useMigrationStore } from './stores/migration'
import { useLibraryStore } from './stores/library'
import { useEbookSessionStore } from './stores/ebook-session'
import { usePdfSessionStore } from './stores/pdf-session'
import { configurePdfAnnotationRepository, usePdfAnnotationStore } from './stores/pdf-annotations'
import { configureEbookAnnotationRepository, useEbookAnnotationStore } from './stores/ebook-annotations'

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
  const ebookSession = useEbookSessionStore(pinia)
  const pdfSession = usePdfSessionStore(pinia)
  configurePdfAnnotationRepository(bookRepository)
  const pdfAnnotations = usePdfAnnotationStore(pinia)
  configureEbookAnnotationRepository(bookRepository)
  const ebookAnnotations = useEbookAnnotationStore(pinia)
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
    onAnnotationRepair: (annotation, generation) => { void ebookAnnotations.applyRepair(annotation, generation) },
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
  library.attachEbookPort(ebookSession)
  library.attachPdfPort(pdfSession)
  watch(
    [() => ebookSession.record, () => ebookSession.generation, () => ebookSession.status],
    ([sessionRecord, generation, status]) => {
      const record = status === 'ready' ? library.books.find(book => book.id === sessionRecord?.id) ?? null : null
      ebookAnnotations.synchronizeSession({ record, generation })
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
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
}

await startReader()
