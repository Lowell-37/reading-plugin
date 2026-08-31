import type { BookFormat, BookRecord } from '../../src/core/types'
// @ts-expect-error JavaScript compatibility repository has no declaration file yet.
import { bookRepository } from '../../src/book-repository.js'
// @ts-expect-error JavaScript compatibility backup module has no declaration file yet.
import { backupFileName, createLibraryBackup, parseLibraryBackup } from '../../src/library-backup.js'

export interface LibraryRepository {
  save(file: File, format: BookFormat): Promise<BookRecord>
  update(id: string, changes: Partial<BookRecord>): Promise<void>
  list(): Promise<BookRecord[]>
  restore(records: BookRecord[]): Promise<unknown>
  delete(id: string): Promise<void>
}

export interface ParsedLibraryBackup {
  settings: Record<string, unknown>
  records: BookRecord[]
}

export interface LibraryDependencies {
  repository: LibraryRepository
  createBackup(records: BookRecord[], settings: Record<string, unknown>): Promise<Blob>
  parseBackup(archive: Blob): Promise<ParsedLibraryBackup>
  download(blob: Blob, name: string): void
  now(): number
  backupName(): string
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const defaultLibraryDependencies: LibraryDependencies = {
  repository: bookRepository,
  createBackup: createLibraryBackup,
  parseBackup: parseLibraryBackup,
  download,
  now: () => Date.now(),
  backupName: () => backupFileName(),
}
