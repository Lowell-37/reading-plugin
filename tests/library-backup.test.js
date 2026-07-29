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

async function rewriteManifest(archive, update) {
  const magicLength = new TextEncoder().encode('QUIETREADER-BACKUP\n').length
  const headerSize = magicLength + 4
  const header = new Uint8Array(await archive.slice(0, headerSize).arrayBuffer())
  const manifestLength = new DataView(header.buffer, magicLength, 4).getUint32(0, true)
  const manifest = JSON.parse(await archive.slice(headerSize, headerSize + manifestLength).text())
  update(manifest)
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const lengthBytes = new Uint8Array(4)
  new DataView(lengthBytes.buffer).setUint32(0, manifestBytes.length, true)
  return new Blob([
    header.subarray(0, magicLength),
    lengthBytes,
    manifestBytes,
    archive.slice(headerSize + manifestLength),
  ])
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
  assert.equal(restored.databaseSchemaVersion, 2)
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

test('accepts legacy backups without a database schema marker', async () => {
  const archive = await createLibraryBackup([book], {})
  const legacyArchive = await rewriteManifest(archive, manifest => delete manifest.databaseSchemaVersion)
  const restored = await parseLibraryBackup(legacyArchive)
  assert.equal(restored.databaseSchemaVersion, 1)
})

test('rejects backups created by a newer database schema', async () => {
  const archive = await createLibraryBackup([book], {})
  const futureArchive = await rewriteManifest(archive, manifest => {
    manifest.databaseSchemaVersion = 3
  })
  await assert.rejects(() => parseLibraryBackup(futureArchive), /requires a newer extension/)
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
