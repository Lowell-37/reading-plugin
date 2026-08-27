import { describe, expect, test } from 'vitest'
import {
  inspectMigrationSnapshot,
  normalizeReaderSettings,
  type MigrationSnapshot,
} from '../src/core/migration-preflight'

const validBook = {
  id: 'book-1',
  name: 'Continuity.epub',
  type: 'application/epub+zip',
  size: 12,
  lastModified: 1234,
  format: 'epub',
  openedAt: 5678,
  blob: new Blob(['book payload']),
  progress: { kind: 'ebook', cfi: 'epubcfi(/6/4)', fraction: 0.42 },
  annotations: [{ id: 'note-1', text: 'Preserved note' }],
}

function snapshot(overrides: Partial<MigrationSnapshot> = {}): MigrationSnapshot {
  return {
    databaseExists: true,
    databaseVersion: 2,
    stores: ['books', 'meta'],
    schema: { key: 'schema', version: 2, migratedAt: '2026-08-27T00:00:00.000Z' },
    books: [validBook],
    rawSettings: JSON.stringify({ theme: 'sepia', fontSize: 22, customReaderFlag: 'keep-me' }),
    ...overrides,
  }
}

describe('WXT migration preflight', () => {
  test('accepts a new profile without creating a database', async () => {
    const result = await inspectMigrationSnapshot(snapshot({
      databaseExists: false,
      databaseVersion: null,
      stores: [],
      schema: null,
      books: [],
      rawSettings: null,
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary).toMatchObject({ databaseExists: false, databaseVersion: null, bookCount: 0 })
  })

  test('summarizes readable v2 books without exposing settings secrets', async () => {
    const result = await inspectMigrationSnapshot(snapshot({
      rawSettings: JSON.stringify({
        theme: 'sepia',
        fontSize: 22,
        aiApiKey: 'never-export-this',
        customReaderFlag: 'keep-me',
      }),
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary).toMatchObject({
      databaseVersion: 2,
      bookCount: 1,
      blobBytes: 12,
      booksWithProgress: 1,
      booksWithAnnotations: 1,
      settingsKeys: ['aiApiKey', 'fontSize', 'theme'],
    })
    expect(JSON.stringify(result.diagnostic)).not.toContain('never-export-this')
  })

  test.each([
    ['database-version-newer', { databaseVersion: 3 }],
    ['missing-store', { stores: ['books'] }],
    ['missing-schema', { schema: null }],
    ['schema-version-mismatch', { schema: { key: 'schema', version: 1 } }],
    ['invalid-book', { books: [{ ...validBook, id: '' }] }],
    ['unreadable-book-blob', { books: [{ ...validBook, blob: { size: 12 } }] }],
  ] as const)('returns structured %s errors', async (code, overrides) => {
    const result = await inspectMigrationSnapshot(snapshot(overrides as Partial<MigrationSnapshot>))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(code)
    expect(result.error.diagnostic).not.toHaveProperty('books')
  })

  test('normalizes known settings in memory and preserves unknown fields', () => {
    const normalized = normalizeReaderSettings({
      theme: 'invalid-theme',
      flow: 'scrolled',
      font: 42,
      fontSize: 999,
      lineHeight: Number.NaN,
      pageWidth: 900,
      headerCollapsed: 'yes',
      customReaderFlag: 'keep-me',
    })

    expect(normalized.settings).toMatchObject({
      theme: 'paper',
      flow: 'scrolled',
      font: 'serif',
      fontSize: 20,
      lineHeight: 1.75,
      pageWidth: 900,
      headerCollapsed: false,
      customReaderFlag: 'keep-me',
    })
    expect(normalized.warnings).toEqual(expect.arrayContaining([
      'theme', 'font', 'fontSize', 'lineHeight', 'headerCollapsed',
    ]))
  })

  test('falls back cleanly when stored settings JSON is malformed', async () => {
    const result = await inspectMigrationSnapshot(snapshot({ rawSettings: '{not-json' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.theme).toBe('paper')
    expect(result.summary.settingsWarnings).toEqual(['settings-json'])
  })
})
