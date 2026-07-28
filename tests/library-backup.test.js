import assert from 'node:assert/strict'
import { test } from 'vitest'
import { backupFileName, createLibraryBackup, parseLibraryBackup } from '../src/library-backup.js'

const book = {
  id: 'book-1',
  name: 'example.epub',
  type: 'application/epub+zip',
  size: 12,
  lastModified: 1234,
  format: 'epub',
  openedAt: 5678,
  progress: { fraction: 0.42, cfi: 'epubcfi(/6/2)' },
  annotations: [{ id: 'note-1', text: 'Remember this' }],
  metadata: { title: 'Example', author: 'Reader' },
  blob: new File(['book payload'], 'example.epub', { type: 'application/epub+zip', lastModified: 1234 }),
  cover: new Blob(['cover'], { type: 'image/png' }),
}

test('round-trips books, progress, annotations, cover and non-secret settings', async () => {
  const archive = await createLibraryBackup([book], {
    theme: 'sepia',
    fontSize: 22,
    aiModel: 'example-model',
    aiApiKey: 'must-not-leave-the-browser',
  }, { createdAt: '2026-07-28T00:00:00.000Z' })
  const restored = await parseLibraryBackup(archive)

  assert.equal(restored.version, 1)
  assert.equal(restored.createdAt, '2026-07-28T00:00:00.000Z')
  assert.deepEqual(restored.secretsExcluded, ['settings.aiApiKey'])
  assert.equal(restored.settings.theme, 'sepia')
  assert.equal(restored.settings.fontSize, 22)
  assert.equal(restored.settings.aiApiKey, undefined)
  assert.deepEqual(restored.records[0].progress, book.progress)
  assert.deepEqual(restored.records[0].annotations, book.annotations)
  assert.equal(await restored.records[0].blob.text(), 'book payload')
  assert.equal(await restored.records[0].cover.text(), 'cover')
})

test('rejects a corrupted book payload before returning records', async () => {
  const archive = await createLibraryBackup([book], {})
  const bytes = new Uint8Array(await archive.arrayBuffer())
  bytes[bytes.length - book.cover.size - 1] ^= 0xff
  await assert.rejects(() => parseLibraryBackup(new Blob([bytes])), /checksum failed/)
})

test('rejects unrelated files and creates portable backup names', async () => {
  await assert.rejects(() => parseLibraryBackup(new Blob(['not a backup'])), /signature|too small/)
  assert.equal(backupFileName(new Date('2026-07-28T12:34:56.000Z')), 'quiet-reader-2026-07-28_12-34-56-000.quietreader')
})
