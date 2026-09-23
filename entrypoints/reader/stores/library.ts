import { shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { BookRecord } from '../../../src/core/types'
import { detectFormat } from '../../../src/core/formats'
import type { EbookSessionPort } from '../ebook-session-port'
import type { LegacyReaderPort } from '../legacy-reader-port'
import type { PdfSessionPort } from '../pdf-session-port'
import { useSettingsStore } from './settings'
import {
  defaultLibraryDependencies,
  type LibraryDependencies,
  type LibraryRepository,
} from '../library-dependencies'

export type { LibraryDependencies, LibraryRepository }

export function createLibraryStore(dependencies: LibraryDependencies = defaultLibraryDependencies) {
  return defineStore('library', () => {
    const books = shallowRef<BookRecord[]>([])
    const backupState = shallowRef<'idle' | 'working' | 'exported' | 'restored' | 'error'>('idle')
    const backupStatus = shallowRef('备份包含书籍、进度、高亮、批注和设置，不包含 API 密钥')
    let legacyPort: LegacyReaderPort | null = null
    let ebookPort: EbookSessionPort | null = null
    let pdfPort: PdfSessionPort | null = null
    type SessionPort = EbookSessionPort | PdfSessionPort
    let activeOwner: { port: SessionPort, request: number } | null = null
    let routeGeneration = 0
    let closeBarrier: Promise<void> = Promise.resolve()
    let resolveLegacyPortReady: (port: LegacyReaderPort) => void = () => undefined
    let legacyPortReady: Promise<LegacyReaderPort>
    let resolveEbookPortReady: (port: EbookSessionPort) => void = () => undefined
    let ebookPortReady: Promise<EbookSessionPort>
    let resolvePdfPortReady: (port: PdfSessionPort) => void = () => undefined
    let pdfPortReady: Promise<PdfSessionPort>

    function resetLegacyPortReady() {
      legacyPortReady = new Promise(resolve => { resolveLegacyPortReady = resolve })
    }

    function resetEbookPortReady() {
      ebookPortReady = new Promise(resolve => { resolveEbookPortReady = resolve })
    }

    function resetPdfPortReady() {
      pdfPortReady = new Promise(resolve => { resolvePdfPortReady = resolve })
    }

    resetLegacyPortReady()
    resetEbookPortReady()
    resetPdfPortReady()

    function attachLegacyPort(nextPort: LegacyReaderPort | null) {
      legacyPort = nextPort
      if (nextPort) resolveLegacyPortReady(nextPort)
      else resetLegacyPortReady()
    }

    function attachEbookPort(nextPort: EbookSessionPort | null) {
      ebookPort = nextPort
      if (nextPort) resolveEbookPortReady(nextPort)
      else resetEbookPortReady()
    }

    function attachPdfPort(nextPort: PdfSessionPort | null) {
      pdfPort = nextPort
      if (nextPort) resolvePdfPortReady(nextPort)
      else resetPdfPortReady()
    }

    function attachPort(nextPort: LegacyReaderPort | null) {
      attachLegacyPort(nextPort)
    }

    function sorted(records: BookRecord[]) {
      return [...records].sort((left, right) => right.openedAt - left.openedAt)
    }

    function requireLegacyPort() {
      return legacyPort ? Promise.resolve(legacyPort) : legacyPortReady
    }

    function requireEbookPort() {
      return ebookPort ? Promise.resolve(ebookPort) : ebookPortReady
    }

    function requirePdfPort() {
      return pdfPort ? Promise.resolve(pdfPort) : pdfPortReady
    }

    function isEbookFormat(format: BookRecord['format']) {
      return format === 'epub' || format === 'mobi' || format === 'azw3'
    }

    function queueClose(port: SessionPort, onlyIfUnowned = false) {
      const closing = closeBarrier.then(async () => {
        // A late completion may belong to a port already reused by a newer
        // generation. Its store owns that isolation; closing it would kill the new session.
        if (!onlyIfUnowned || activeOwner?.port !== port) await port.close()
      })
      closeBarrier = closing.catch(() => undefined)
      return closing
    }

    function closeActivePort() {
      const owner = activeOwner
      activeOwner = null
      return owner ? queueClose(owner.port) : closeBarrier
    }

    async function openRecordWithPort(record: BookRecord, request: number) {
      const nextPort = record.format === 'pdf' ? 'pdf' : isEbookFormat(record.format) ? 'ebook' : null
      if (!nextPort || request !== routeGeneration) return
      await closeActivePort()
      if (request !== routeGeneration) return
      const port = await (nextPort === 'pdf' ? requirePdfPort() : requireEbookPort())
      // Late opens can append cleanup while we await a previous close or port
      // attachment. Drain the current barrier before giving this port new work.
      let closing: Promise<void>
      do {
        closing = closeBarrier
        await closing
      } while (closing !== closeBarrier)
      if (request !== routeGeneration) return
      // Loading is ownership too: a replacement/close must cancel this port
      // before it starts its own engine, without waiting for this open to resolve.
      const owner = { port, request }
      activeOwner = owner
      try {
        await port.open(record, { ...useSettingsStore().settings })
      } finally {
        if (request !== routeGeneration || activeOwner !== owner) await queueClose(port, true)
      }
    }

    async function load() {
      books.value = sorted(await dependencies.repository.list())
    }

    async function openFile(file: File) {
      const format = detectFormat(file.name, file.type)
      if (!format) throw new Error('不支持这个文件格式')
      const request = ++routeGeneration
      const record = await dependencies.repository.save(file, format)
      books.value = sorted([...books.value.filter(book => book.id !== record.id), record])
      await openRecordWithPort(record, request)
    }

    async function openRecord(record: BookRecord) {
      const request = record.format === 'pdf' || isEbookFormat(record.format) ? ++routeGeneration : routeGeneration
      const updated = { ...record, openedAt: dependencies.now() }
      await dependencies.repository.update(record.id, { openedAt: updated.openedAt })
      books.value = sorted(books.value.map(book => book.id === record.id ? updated : book))
      await openRecordWithPort(updated, request)
    }

    async function closeSession() {
      routeGeneration += 1
      await closeActivePort()
      await load()
    }

    async function remove(id: string) {
      await dependencies.repository.delete(id)
      await load()
    }

    async function backup() {
      backupState.value = 'working'
      backupStatus.value = '正在校验并打包本地书库…'
      try {
        if (activeOwner) await activeOwner.port.flushProgress()
        else await (await requireLegacyPort()).flushProgress()
        const records = await dependencies.repository.list()
        books.value = sorted(records)
        const settings = useSettingsStore()
        const archive = await dependencies.createBackup(records, { ...settings.settings })
        dependencies.download(archive, dependencies.backupName())
        backupState.value = 'exported'
        backupStatus.value = `备份完成：${records.length} 本书；API 密钥未写入备份`
      } catch (error) {
        backupState.value = 'error'
        backupStatus.value = '备份失败，原书库未被修改'
        throw error
      }
    }

    async function restore(file: File) {
      backupState.value = 'working'
      backupStatus.value = '正在验证备份完整性…'
      try {
        const parsed = await dependencies.parseBackup(file)
        await dependencies.repository.restore(parsed.records)
        await useSettingsStore().restoreNonSensitive(parsed.settings)
        await load()
        backupState.value = 'restored'
        backupStatus.value = `恢复完成：${parsed.records.length} 本书；现有同名记录已更新`
      } catch (error) {
        backupState.value = 'error'
        backupStatus.value = '恢复失败，未写入未经验证的数据'
        throw error
      }
    }

    return {
      books,
      backupState,
      backupStatus,
      attachPort,
      attachLegacyPort,
      attachEbookPort,
      attachPdfPort,
      load,
      openFile,
      openRecord,
      closeSession,
      remove,
      backup,
      restore,
    }
  })
}

export const useLibraryStore = createLibraryStore()
