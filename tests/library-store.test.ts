// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
// @ts-expect-error JavaScript compatibility backup module has no declaration file yet.
import { createLibraryBackup, parseLibraryBackup } from '../src/library-backup.js'
import type { BookFormat, BookRecord } from '../src/core/types'
import type { EbookSessionPort } from '../entrypoints/reader/ebook-session-port'
import type { LegacyReaderPort } from '../entrypoints/reader/legacy-reader-port'
import {
  createLibraryStore,
  type LibraryRepository,
} from '../entrypoints/reader/stores/library'
import { useSettingsStore } from '../entrypoints/reader/stores/settings'

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

  test('openFile detects the shared format, saves once, then opens the saved PDF record as newly saved', async () => {
    const store = useStore()
    store.attachLegacyPort(port)
    const file = bookFile('fresh.pdf', 'application/pdf')

    await store.openFile(file)

    expect(repository.calls.save).toBe(1)
    expect(repository.savedFormats).toEqual(['pdf'])
    expect(port.opened).toHaveLength(1)
    expect(port.opened[0]).toMatchObject({ record: { name: 'fresh.pdf' }, options: { newlySaved: true } })
    expect(repository.events).toEqual(['save:fresh.pdf', 'open:fresh.pdf'])
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

  async close() {}

  async goTo() {}

  async navigate() {}

  async setFlow() {}

  async applySettings() {}

  async flushProgress() {}

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
