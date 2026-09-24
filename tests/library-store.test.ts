// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
// @ts-expect-error JavaScript compatibility backup module has no declaration file yet.
import { createLibraryBackup, parseLibraryBackup } from '../src/library-backup.js'
import type { BookFormat, BookRecord } from '../src/core/types'
import type { EbookSessionPort } from '../entrypoints/reader/ebook-session-port'
import type { LegacyReaderPort } from '../entrypoints/reader/legacy-reader-port'
import type { PdfSessionPort } from '../entrypoints/reader/pdf-session-port'
import {
  createLibraryStore,
  type LibraryRepository,
} from '../entrypoints/reader/stores/library'
import { useSettingsStore } from '../entrypoints/reader/stores/settings'
import { createPdfSessionStore } from '../entrypoints/reader/stores/pdf-session'
import { createEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import { useReaderStore } from '../entrypoints/reader/stores/reader'

describe('reader library store', () => {
  let repository: MemoryRepository
  let port: RecordingPort
  let downloads: Array<{ blob: Blob, name: string }>
  let useStore: ReturnType<typeof createLibraryStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    repository = new MemoryRepository()
    port = new RecordingPort(repository.events)
    downloads = []
    useStore = createLibraryStore({
      repository,
      createBackup: createLibraryBackup,
      parseBackup: parseLibraryBackup,
      download(blob, name) {
        repository.events.push('download')
        downloads.push({ blob, name })
      },
      now: () => 9000,
      backupName: () => 'library.quietreader',
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  test('load rereads the repository once and sorts its snapshot by openedAt', async () => {
    repository.seed(record('older.epub', 10), record('newer.pdf', 30), record('middle.mobi', 20))
    const store = useStore()

    await store.load()

    expect(store.books.map(book => book.name)).toEqual(['newer.pdf', 'middle.mobi', 'older.epub'])
    expect(repository.calls.list).toBe(1)
  })

  test('openFile sends PDF records only to the PDF session', async () => {
    const store = useStore()
    const pdf = new RecordingPdfPort(repository.events)
    store.attachLegacyPort(port)
    store.attachPdfPort(pdf)
    const file = bookFile('fresh.pdf', 'application/pdf')

    await store.openFile(file)

    expect(repository.calls.save).toBe(1)
    expect(repository.savedFormats).toEqual(['pdf'])
    expect(pdf.opened).toHaveLength(1)
    expect(pdf.opened[0]).toMatchObject({ record: { name: 'fresh.pdf', format: 'pdf' } })
    expect(port.opened).toHaveLength(0)
    expect(repository.events).toEqual(['save:fresh.pdf', 'pdf-open:fresh.pdf'])
  })

  test('closes the active format port before opening a record in another format', async () => {
    const ebook = new RecordingEbookPort(repository.events)
    const pdf = new RecordingPdfPort(repository.events)
    const first = record('first.epub', 100)
    const next = record('next.pdf', 200)
    const last = record('last.mobi', 300)
    repository.seed(first, next, last)
    const store = useStore()
    store.attachLegacyPort(port)
    store.attachEbookPort(ebook)
    store.attachPdfPort(pdf)

    await store.openRecord(first)
    await store.openRecord(next)
    await store.openRecord(last)

    expect(repository.events).toEqual([
      'update:first.epub', 'ebook-open:first.epub',
      'update:next.pdf', 'ebook-close', 'pdf-open:next.pdf',
      'update:last.mobi', 'pdf-close', 'ebook-open:last.mobi',
    ])
    expect(port.opened).toHaveLength(0)
  })

  test.each(['pdf', 'ebook'] as const)('replaces a loading %s owner before opening the other format and ignores its late completion', async firstKind => {
    const store = useStore()
    const first = new DeferredSessionPort(repository.events, firstKind)
    const nextKind = firstKind === 'pdf' ? 'ebook' : 'pdf'
    const next = new DeferredSessionPort(repository.events, nextKind)
    if (firstKind === 'pdf') { store.attachPdfPort(first); store.attachEbookPort(next) }
    else { store.attachEbookPort(first); store.attachPdfPort(next) }
    const firstRecord = record(firstKind === 'pdf' ? 'first.pdf' : 'first.epub', 100)
    const nextRecord = record(firstKind === 'pdf' ? 'next.epub' : 'next.pdf', 200)
    const opening = store.openRecord(firstRecord)
    await vi.waitFor(() => expect(first.opens).toHaveLength(1))
    const replacement = store.openRecord(nextRecord)
    await vi.waitFor(() => expect(next.opens).toHaveLength(1))
    expect(repository.events).toContain(`${firstKind}-close`)
    expect(repository.events.indexOf(`${firstKind}-close`)).toBeLessThan(repository.events.indexOf(`${nextKind}-open:${nextRecord.name}`))
    expect(first.active).toBeNull()
    next.opens[0]!.resolve()
    await replacement
    first.opens[0]!.resolve()
    await opening
    expect(first.active).toBeNull()
    expect(next.active).toBe(nextRecord.id)
    await store.backup()
    expect(repository.events).toContain(`${nextKind}-flush`)
    expect(repository.events).not.toContain(`${firstKind}-flush`)
    await store.closeSession()
    expect(next.active).toBeNull()
  })

  test.each(['pdf', 'ebook'] as const)('late %s cleanup preserves the actual replacement store and shared reader projection', async firstKind => {
    const store = useStore()
    const oldOpen = deferred()
    const pdf = createPdfSessionStore(callbacks => ({
      async open() {
        if (firstKind === 'pdf') await oldOpen.promise
        callbacks.onSnapshot({ status: 'ready', title: 'Current PDF', outline: [], page: 1, pageCount: 3, zoom: 1, progress: 0, error: null, generation: 1 })
      },
      async close() {}, async flushProgress() {}, async goTo() {}, async navigate() {}, async setZoom() {},
      readRenderedTextLayer() { return null },
      destroy() {},
    }))()
    const ebook = createEbookSessionStore(callbacks => ({
      async open() {
        if (firstKind === 'ebook') await oldOpen.promise
        callbacks.onSnapshot({ status: 'ready', title: 'Current Ebook', toc: [], chapter: 'One', progress: 0, flow: 'paginated', error: null, generation: 1 })
      },
      async close() {}, async flushProgress() {}, async goTo() {}, async navigate() {}, async setFlow() {}, async applySettings() {}, destroy() {},
    }))()
    store.attachPdfPort(pdf)
    store.attachEbookPort(ebook)
    const first = store.openRecord(record(firstKind === 'pdf' ? 'old.pdf' : 'old.epub', 1))
    await vi.waitFor(() => expect(firstKind === 'pdf' ? pdf.status : ebook.status).toBe('loading'))
    await store.openRecord(record(firstKind === 'pdf' ? 'new.epub' : 'new.pdf', 2))
    const title = firstKind === 'pdf' ? 'Current Ebook' : 'Current PDF'
    expect(useReaderStore().title).toBe(title)
    oldOpen.resolve()
    await first
    expect(useReaderStore().isReading).toBe(true)
    expect(useReaderStore().title).toBe(title)
    expect(firstKind === 'pdf' ? pdf.record : ebook.record).toBeNull()
    expect(firstKind === 'pdf' ? ebook.status : pdf.status).toBe('ready')
  })

  test('close invalidates an opening request and closes resources arriving after cancellation', async () => {
    const store = useStore()
    const pdf = new DeferredSessionPort(repository.events, 'pdf')
    store.attachPdfPort(pdf)
    const opening = store.openRecord(record('pending.pdf', 100))
    await vi.waitFor(() => expect(pdf.opens).toHaveLength(1))
    await store.closeSession()
    expect(pdf.active).toBeNull()
    pdf.opens[0]!.resolve()
    await opening
    expect(pdf.active).toBeNull()
  })

  test('latest route wins while an old owner close is pending, and stale completion does not close a reused port', async () => {
    const store = useStore()
    const pdf = new DeferredSessionPort(repository.events, 'pdf')
    const ebook = new DeferredSessionPort(repository.events, 'ebook')
    store.attachPdfPort(pdf)
    store.attachEbookPort(ebook)
    const first = store.openRecord(record('first.pdf', 100))
    await vi.waitFor(() => expect(pdf.opens).toHaveLength(1))
    const closing = deferred()
    pdf.closeGate = closing.promise
    const second = store.openRecord(record('intermediate.epub', 200))
    await vi.waitFor(() => expect(repository.events).toContain('pdf-close'))
    const latest = store.openRecord(record('latest.pdf', 300))
    closing.resolve()
    await vi.waitFor(() => expect(pdf.opens).toHaveLength(2))
    pdf.opens[1]!.resolve()
    await latest
    await second
    pdf.opens[0]!.resolve()
    await first
    expect(ebook.opens).toHaveLength(0)
    expect(pdf.active).toBe('id-latest.pdf')
    await store.backup()
    expect(repository.events).toContain('pdf-flush')
  })

  test('an earlier repository write cannot route after a later request or a close', async () => {
    const store = useStore()
    const pdf = new RecordingPdfPort(repository.events)
    const ebook = new RecordingEbookPort(repository.events)
    store.attachPdfPort(pdf)
    store.attachEbookPort(ebook)
    const saved = deferred()
    const save = repository.save.bind(repository)
    vi.spyOn(repository, 'save').mockImplementation(async (...args) => { await saved.promise; return save(...args) })
    const first = store.openFile(bookFile('slow.pdf'))
    await store.openRecord(record('latest.epub', 300))
    saved.resolve()
    await first
    expect(pdf.opened).toHaveLength(0)
    expect(ebook.opened).toHaveLength(1)

    const update = deferred()
    vi.spyOn(repository, 'update').mockImplementation(async () => { await update.promise })
    const after = store.openRecord(record('late.pdf', 400))
    await store.closeSession()
    update.resolve()
    await after
    expect(pdf.opened).toHaveLength(0)
  })

  test('a reused port waits for late cleanup appended while the route is already waiting to close', async () => {
    const store = useStore()
    const ebook = new DeferredSessionPort(repository.events, 'ebook')
    const pdf = new DeferredSessionPort(repository.events, 'pdf')
    store.attachEbookPort(ebook)
    store.attachPdfPort(pdf)
    const first = store.openRecord(record('old.epub', 1))
    await vi.waitFor(() => expect(ebook.opens).toHaveLength(1))
    const second = store.openRecord(record('middle.pdf', 2))
    await vi.waitFor(() => expect(pdf.opens).toHaveLength(1))
    pdf.opens[0]!.resolve()
    await second
    const pdfClose = deferred()
    pdf.closeGate = pdfClose.promise
    const latest = store.openRecord(record('latest.epub', 3))
    await vi.waitFor(() => expect(repository.events).toContain('pdf-close'))
    const lateCleanup = deferred()
    ebook.closeGate = lateCleanup.promise
    ebook.opens[0]!.resolve()
    pdfClose.resolve()
    await vi.waitFor(() => expect(repository.events.filter(event => event === 'ebook-close')).toHaveLength(2))
    expect(ebook.opens).toHaveLength(1)
    lateCleanup.resolve()
    await first
    await vi.waitFor(() => expect(ebook.opens).toHaveLength(2))
    ebook.opens[1]!.resolve()
    await latest
    expect(ebook.active).toBe('id-latest.epub')
  })

  test('close invalidates a request still waiting for its port attachment', async () => {
    const store = useStore()
    const pending = store.openFile(bookFile('startup.pdf'))
    await vi.waitFor(() => expect(repository.calls.save).toBe(1))
    await store.closeSession()
    const pdf = new RecordingPdfPort(repository.events)
    store.attachPdfPort(pdf)
    await pending
    expect(pdf.opened).toHaveLength(0)
  })

  test.each([
    ['epub', 'application/epub+zip'],
    ['mobi', 'application/x-mobipocket-ebook'],
    ['azw3', 'application/octet-stream'],
  ] as const)('openFile sends %s records only to the ebook session', async (format, type) => {
    const ebook = new RecordingEbookPort(repository.events)
    const store = useStore()
    store.attachLegacyPort(port)
    store.attachEbookPort(ebook)

    await store.openFile(bookFile(`fresh.${format}`, type))

    expect(ebook.opened).toHaveLength(1)
    expect(ebook.opened[0]).toMatchObject({
      record: { name: `fresh.${format}`, format },
      settings: expect.objectContaining({ flow: 'paginated' }),
    })
    expect(port.opened).toHaveLength(0)
    expect(repository.events).toEqual([`save:fresh.${format}`, `ebook-open:fresh.${format}`])
  })

  test.each(['epub', 'mobi', 'azw3'] as const)('openRecord sends stored %s records only to the ebook session', async format => {
    const ebook = new RecordingEbookPort(repository.events)
    const source = record(`stored.${format}`, 100)
    repository.seed(source)
    const store = useStore()
    store.attachLegacyPort(port)
    store.attachEbookPort(ebook)

    await store.openRecord(source)

    expect(ebook.opened).toHaveLength(1)
    expect(ebook.opened[0]?.record).toMatchObject({ id: source.id, format, openedAt: 9000 })
    expect(port.opened).toHaveLength(0)
    expect(repository.events).toEqual([`update:stored.${format}`, `ebook-open:stored.${format}`])
  })

  test('openFile waits for the asynchronously attached engine port instead of abandoning a saved record', async () => {
    const store = useStore()
    const pending = store.openFile(bookFile('startup.epub', 'application/epub+zip'))
    await Promise.resolve()

    expect(repository.calls.save).toBe(1)
    expect(port.opened).toHaveLength(0)
    const ebook = new RecordingEbookPort(repository.events)
    store.attachEbookPort(ebook)
    await pending

    expect(ebook.opened).toHaveLength(1)
    expect(port.opened).toHaveLength(0)
    expect(repository.events).toEqual(['save:startup.epub', 'ebook-open:startup.epub'])
  })

  test('openFile rejects an unsupported file before persistence or engine work', async () => {
    const store = useStore()
    store.attachLegacyPort(port)

    await expect(store.openFile(bookFile('notes.txt', 'text/plain'))).rejects.toThrow(/不支持|unsupported/i)

    expect(repository.calls.save).toBe(0)
    expect(port.opened).toHaveLength(0)
  })

  test('openRecord persists openedAt once before handing the updated record to the port', async () => {
    const source = record('stored.azw3', 100)
    repository.seed(source)
    const store = useStore()
    const ebook = new RecordingEbookPort(repository.events)
    store.attachEbookPort(ebook)

    await store.openRecord(source)

    expect(repository.calls.update).toBe(1)
    expect(repository.updated).toEqual([{ id: source.id, changes: { openedAt: 9000 } }])
    expect(ebook.opened[0]?.record.openedAt).toBe(9000)
    expect(port.opened).toHaveLength(0)
    expect(repository.events).toEqual(['update:stored.azw3', 'ebook-open:stored.azw3'])
  })

  test('remove deletes only the requested record once and refreshes the repository projection', async () => {
    const keep = record('keep.epub', 10)
    const remove = record('remove.pdf', 20)
    repository.seed(keep, remove)
    const store = useStore()
    await store.load()
    repository.resetCalls()

    await store.remove(remove.id)

    expect(repository.calls.delete).toBe(1)
    expect(repository.deleted).toEqual([remove.id])
    expect(repository.calls.list).toBe(1)
    expect(store.books.map(book => book.id)).toEqual([keep.id])
  })

  test('backup flushes progress before one repository read and excludes the API key', async () => {
    repository.seed(record('backup.epub', 25, { progress: { kind: 'ebook', cfi: '/6/2', fraction: 0.4 } }))
    localStorage.setItem('quiet-reader-settings', JSON.stringify({ theme: 'dark', aiApiKey: 'never-export' }))
    const store = useStore()
    store.attachLegacyPort(port)

    await store.backup()

    expect(port.calls.flushProgress).toBe(1)
    expect(repository.calls.list).toBe(1)
    expect(repository.events).toEqual(['flush', 'list', 'download'])
    expect(downloads).toHaveLength(1)
    const download = downloads[0]!
    expect(download.name).toBe('library.quietreader')
    const parsed = await parseLibraryBackup(download.blob)
    expect(parsed.records).toHaveLength(1)
    expect(parsed.settings).toMatchObject({ theme: 'dark' })
    expect(parsed.settings).not.toHaveProperty('aiApiKey')
  })

  test('restore fully parses before one repository restore, merges safe settings, and refreshes books', async () => {
    const restored = record('restored.mobi', 55, {
      progress: { kind: 'ebook', cfi: '/8/4', fraction: 0.65 },
    })
    const archive = await createLibraryBackup([restored], { theme: 'sepia', customReaderFlag: 'from-backup' })
    localStorage.setItem('quiet-reader-settings', JSON.stringify({ aiApiKey: 'keep-local', currentOnly: 'keep-too' }))
    const settings = useSettingsStore()
    settings.attachPort(port)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const store = useStore()

    await store.restore(new File([archive], 'saved.quietreader'))

    expect(repository.calls.restore).toBe(1)
    expect(repository.calls.list).toBe(1)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(repository.events.indexOf('restore')).toBeLessThan(repository.events.indexOf('list'))
    expect(store.books.map(book => book.name)).toEqual(['restored.mobi'])
    expect(settings.settings).toMatchObject({
      theme: 'sepia',
      customReaderFlag: 'from-backup',
      currentOnly: 'keep-too',
      aiApiKey: 'keep-local',
    })
    expect(port.applied).toHaveLength(1)
  })

  test('restore writes nothing when any part of the backup is invalid', async () => {
    repository.seed(record('existing.epub', 1))
    localStorage.setItem('quiet-reader-settings', JSON.stringify({ theme: 'dark', aiApiKey: 'keep-local' }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const store = useStore()

    await expect(store.restore(new File(['not a Quiet Reader backup'], 'broken.quietreader'))).rejects.toThrow(/Invalid Quiet Reader backup/)

    expect(repository.calls.restore).toBe(0)
    expect(repository.calls.list).toBe(0)
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}')).toEqual({
      theme: 'dark',
      aiApiKey: 'keep-local',
    })
  })
})

class MemoryRepository implements LibraryRepository {
  records = new Map<string, BookRecord>()
  calls = { save: 0, update: 0, list: 0, restore: 0, delete: 0 }
  events: string[] = []
  savedFormats: BookFormat[] = []
  updated: Array<{ id: string, changes: Partial<BookRecord> }> = []
  deleted: string[] = []

  seed(...records: BookRecord[]) {
    this.records = new Map(records.map(item => [item.id, item]))
  }

  resetCalls() {
    this.calls = { save: 0, update: 0, list: 0, restore: 0, delete: 0 }
    this.events.length = 0
    this.savedFormats.length = 0
    this.updated.length = 0
    this.deleted.length = 0
  }

  async save(file: File, format: BookFormat) {
    this.calls.save += 1
    this.events.push(`save:${file.name}`)
    this.savedFormats.push(format)
    const saved = record(file.name, 9000, { blob: file, format })
    this.records.set(saved.id, saved)
    return saved
  }

  async update(id: string, changes: Partial<BookRecord>) {
    this.calls.update += 1
    const current = this.records.get(id)
    this.events.push(`update:${current?.name || id}`)
    this.updated.push({ id, changes })
    if (current) this.records.set(id, { ...current, ...changes })
  }

  async list() {
    this.calls.list += 1
    this.events.push('list')
    return [...this.records.values()]
  }

  async restore(records: BookRecord[]) {
    this.calls.restore += 1
    this.events.push('restore')
    for (const restored of records) this.records.set(restored.id, restored)
    return records.length
  }

  async delete(id: string) {
    this.calls.delete += 1
    this.events.push(`delete:${id}`)
    this.deleted.push(id)
    this.records.delete(id)
  }
}

class RecordingPort implements LegacyReaderPort {
  opened: Array<{ record: BookRecord, options?: { newlySaved?: boolean } }> = []
  applied: Array<Record<string, unknown>> = []
  calls = { closeSession: 0, flushProgress: 0 }

  constructor(private readonly events: string[]) {}

  async openRecord(record: BookRecord, options?: { newlySaved?: boolean }) {
    this.events.push(`open:${record.name}`)
    this.opened.push({ record, options })
  }

  async closeSession() {
    this.calls.closeSession += 1
  }

  async applySettings(settings: Record<string, unknown>) {
    this.applied.push(settings)
  }

  async flushProgress() {
    this.calls.flushProgress += 1
    this.events.push('flush')
  }

  destroy() {}
}

class RecordingEbookPort implements EbookSessionPort {
  opened: Array<{ record: BookRecord, settings: Record<string, unknown> }> = []

  constructor(private readonly events: string[]) {}

  async open(record: BookRecord, settings: Record<string, unknown>) {
    this.events.push(`ebook-open:${record.name}`)
    this.opened.push({ record, settings })
  }

  async close() { this.events.push('ebook-close') }

  async goTo() {}

  async navigate() {}

  async setFlow() {}

  async applySettings() {}

  async flushProgress() {}

  destroy() {}
}

class RecordingPdfPort implements PdfSessionPort {
  opened: Array<{ record: BookRecord, settings: Record<string, unknown> }> = []

  constructor(private readonly events: string[]) {}

  async open(record: BookRecord, settings: Record<string, unknown>) {
    this.events.push(`pdf-open:${record.name}`)
    this.opened.push({ record, settings })
  }

  async close() { this.events.push('pdf-close') }

  async goTo() {}

  async navigate() {}

  async setZoom() {}

  async flushProgress() {}

  readRenderedTextLayer() { return null }

  destroy() {}
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

class DeferredSessionPort implements PdfSessionPort, EbookSessionPort {
  opens: ReturnType<typeof deferred>[] = []
  active: string | null = null
  closeGate: Promise<void> | null = null
  private generation = 0
  constructor(private readonly events: string[], private readonly kind: string) {}
  async open(record: BookRecord) {
    const generation = ++this.generation
    const pending = deferred()
    this.opens.push(pending)
    this.events.push(`${this.kind}-open:${record.name}`)
    this.active = record.id
    await pending.promise
    // Like a store, a newer open supersedes older callbacks. This deliberately
    // allows a late completion after close, so the routing owner must clean it up.
    if (generation === this.generation) this.active = record.id
  }
  async close() { this.events.push(`${this.kind}-close`); await this.closeGate; this.active = null }
  async flushProgress() { this.events.push(`${this.kind}-flush`) }
  async goTo() {}
  async navigate() {}
  async setZoom() {}
  readRenderedTextLayer() { return null }
  async setFlow() {}
  async applySettings() {}
  destroy() {}
}

function bookFile(name: string, type = 'application/octet-stream') {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const file = new File([bytes], name, { type, lastModified: 123 })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  return file
}

function record(name: string, openedAt: number, changes: Partial<BookRecord> = {}): BookRecord {
  const format = (name.split('.').pop() || 'epub') as BookFormat
  const blob = bookFile(name)
  return {
    id: `id-${name}`,
    name,
    type: blob.type,
    size: blob.size,
    lastModified: blob.lastModified,
    format,
    blob,
    openedAt,
    ...changes,
  }
}
