import { DB_VERSION } from './storage-schema.js'

const MAGIC = new TextEncoder().encode('QUIETREADER-BACKUP\n')
const FORMAT = 'quiet-reader-backup'
const VERSION = 1
const MAX_MANIFEST_SIZE = 16 * 1024 * 1024
const MAX_BOOK_COUNT = 5000
const SUPPORTED_FORMATS = new Set(['pdf', 'epub', 'mobi', 'azw3'])

function fail(message) {
  throw new Error(`Invalid Quiet Reader backup: ${message}`)
}

function bytesEqual(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(blob) {
  return toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
}

function serializable(value, label) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    fail(`${label} is not serializable`)
  }
}

function sanitizeSettings(settings) {
  const safe = serializable(settings || {}, 'settings')
  delete safe.aiApiKey
  return safe
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') fail('book record is missing')
  if (typeof record.id !== 'string' || !record.id) fail('book id is missing')
  if (typeof record.name !== 'string' || !record.name) fail('book name is missing')
  if (!SUPPORTED_FORMATS.has(record.format)) fail(`unsupported book format: ${record.format}`)
}

function validateAsset(asset, payloadSize, label) {
  if (!asset || typeof asset !== 'object') fail(`${label} descriptor is missing`)
  for (const property of ['offset', 'length']) {
    if (!Number.isSafeInteger(asset[property]) || asset[property] < 0) fail(`${label} ${property} is invalid`)
  }
  if (asset.offset + asset.length > payloadSize) fail(`${label} exceeds the archive size`)
  if (!/^[a-f0-9]{64}$/.test(asset.sha256 || '')) fail(`${label} checksum is invalid`)
}

export async function createLibraryBackup(records, settings, { createdAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array')
  if (records.length > MAX_BOOK_COUNT) fail('too many books')

  const payload = []
  let offset = 0
  const books = []

  for (const source of records) {
    validateRecord(source)
    if (!(source.blob instanceof Blob)) fail(`book file is missing: ${source.name}`)

    const { blob, cover, ...metadata } = source
    const file = {
      offset,
      length: blob.size,
      type: blob.type || source.type || 'application/octet-stream',
      sha256: await sha256(blob),
    }
    payload.push(blob)
    offset += blob.size

    let coverAsset = null
    if (cover instanceof Blob) {
      coverAsset = {
        offset,
        length: cover.size,
        type: cover.type || 'application/octet-stream',
        sha256: await sha256(cover),
      }
      payload.push(cover)
      offset += cover.size
    }

    books.push({ record: serializable(metadata, `book ${source.name}`), file, cover: coverAsset })
  }

  const manifest = {
    format: FORMAT,
    version: VERSION,
    databaseSchemaVersion: DB_VERSION,
    createdAt,
    secretsExcluded: ['settings.aiApiKey'],
    settings: sanitizeSettings(settings),
    books,
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  if (manifestBytes.length > MAX_MANIFEST_SIZE) fail('manifest is too large')
  const lengthBytes = new Uint8Array(4)
  new DataView(lengthBytes.buffer).setUint32(0, manifestBytes.length, true)

  return new Blob([MAGIC, lengthBytes, manifestBytes, ...payload], {
    type: 'application/vnd.quiet-reader.backup',
  })
}

export async function parseLibraryBackup(archive) {
  if (!(archive instanceof Blob)) throw new TypeError('archive must be a Blob')
  const headerSize = MAGIC.length + 4
  if (archive.size < headerSize) fail('file is too small')

  const header = new Uint8Array(await archive.slice(0, headerSize).arrayBuffer())
  if (!bytesEqual(header.subarray(0, MAGIC.length), MAGIC)) fail('signature does not match')
  const manifestLength = new DataView(header.buffer, MAGIC.length, 4).getUint32(0, true)
  if (!manifestLength || manifestLength > MAX_MANIFEST_SIZE) fail('manifest length is invalid')
  const payloadStart = headerSize + manifestLength
  if (payloadStart > archive.size) fail('manifest is truncated')

  let manifest
  try {
    const bytes = await archive.slice(headerSize, payloadStart).arrayBuffer()
    manifest = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    fail('manifest JSON is invalid')
  }
  if (manifest.format !== FORMAT) fail('format does not match')
  if (manifest.version !== VERSION) fail(`unsupported version: ${manifest.version}`)
  const databaseSchemaVersion = manifest.databaseSchemaVersion ?? 1
  if (!Number.isSafeInteger(databaseSchemaVersion) || databaseSchemaVersion < 1) fail('database schema version is invalid')
  if (databaseSchemaVersion > DB_VERSION) fail(`database schema version ${databaseSchemaVersion} requires a newer extension`)
  if (!Array.isArray(manifest.books) || manifest.books.length > MAX_BOOK_COUNT) fail('book list is invalid')

  const payloadSize = archive.size - payloadStart
  const records = []
  const seen = new Set()
  for (const entry of manifest.books) {
    validateRecord(entry?.record)
    if (seen.has(entry.record.id)) fail(`duplicate book id: ${entry.record.id}`)
    seen.add(entry.record.id)
    validateAsset(entry.file, payloadSize, `book ${entry.record.name}`)
    if (entry.cover) validateAsset(entry.cover, payloadSize, `cover ${entry.record.name}`)

    const fileBlob = archive.slice(
      payloadStart + entry.file.offset,
      payloadStart + entry.file.offset + entry.file.length,
      entry.file.type,
    )
    if (await sha256(fileBlob) !== entry.file.sha256) fail(`book checksum failed: ${entry.record.name}`)
    const blob = new File([fileBlob], entry.record.name, {
      type: entry.file.type,
      lastModified: Number(entry.record.lastModified) || 0,
    })

    let cover = null
    if (entry.cover) {
      cover = archive.slice(
        payloadStart + entry.cover.offset,
        payloadStart + entry.cover.offset + entry.cover.length,
        entry.cover.type,
      )
      if (await sha256(cover) !== entry.cover.sha256) fail(`cover checksum failed: ${entry.record.name}`)
    }
    records.push({ ...entry.record, blob, cover })
  }

  return {
    version: manifest.version,
    databaseSchemaVersion,
    createdAt: manifest.createdAt,
    settings: manifest.settings && typeof manifest.settings === 'object' ? manifest.settings : {},
    secretsExcluded: Array.isArray(manifest.secretsExcluded) ? manifest.secretsExcluded : [],
    records,
  }
}

export function backupFileName(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `quiet-reader-${stamp}.quietreader`
}
