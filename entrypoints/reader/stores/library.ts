import { shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { BookRecord } from '../../../src/core/types'
import { detectFormat } from '../../../src/core/formats'
import type { LegacyReaderPort } from '../legacy-reader-port'
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
    let port: LegacyReaderPort | null = null
    let resolvePortReady: (port: LegacyReaderPort) => void = () => undefined
    let portReady: Promise<LegacyReaderPort>

    function resetPortReady() {
      portReady = new Promise(resolve => { resolvePortReady = resolve })
    }

    resetPortReady()

    function attachPort(nextPort: LegacyReaderPort | null) {
      port = nextPort
      if (nextPort) resolvePortReady(nextPort)
      else resetPortReady()
    }

    function sorted(records: BookRecord[]) {
      return [...records].sort((left, right) => right.openedAt - left.openedAt)
    }

    function requirePort() {
      return port ? Promise.resolve(port) : portReady
    }

    async function load() {
      books.value = sorted(await dependencies.repository.list())
    }

    async function openFile(file: File) {
      const format = detectFormat(file.name, file.type)
      if (!format) throw new Error('不支持这个文件格式')
      const record = await dependencies.repository.save(file, format)
      books.value = sorted([...books.value.filter(book => book.id !== record.id), record])
      await (await requirePort()).openRecord(record, { newlySaved: true })
    }

    async function openRecord(record: BookRecord) {
      const updated = { ...record, openedAt: dependencies.now() }
      await dependencies.repository.update(record.id, { openedAt: updated.openedAt })
      books.value = sorted(books.value.map(book => book.id === record.id ? updated : book))
      await (await requirePort()).openRecord(updated)
    }

    async function closeSession() {
      await (await requirePort()).closeSession()
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
        await (await requirePort()).flushProgress()
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
