const EXPECTED_DATABASE_VERSION = 2
const REQUIRED_STORES = ['books', 'meta'] as const
const SETTINGS_KEY = 'quiet-reader-settings'

export const DEFAULT_READER_SETTINGS = {
  theme: 'paper',
  flow: 'paginated',
  font: 'serif',
  fontSize: 20,
  lineHeight: 1.75,
  pageWidth: 760,
  headerCollapsed: false,
  aiEndpoint: 'https://api.openai.com/v1',
  aiModel: '',
  aiApiKey: '',
} as const

export interface MigrationSnapshot {
  databaseExists: boolean
  databaseVersion: number | null
  stores: string[]
  schema: unknown
  books: unknown[]
  rawSettings: string | null
}

export type MigrationPreflightErrorCode =
  | 'database-open-failed'
  | 'database-version-newer'
  | 'database-version-unsupported'
  | 'missing-store'
  | 'missing-schema'
  | 'schema-version-mismatch'
  | 'invalid-book'
  | 'unreadable-book-blob'

export interface MigrationDiagnostic {
  databaseExists: boolean
  databaseVersion: number | null
  stores: string[]
  schemaVersion: number | null
  bookCount: number
  settingsKey: string
  settingsKeys: string[]
  settingsWarnings: string[]
}

interface MigrationSummary extends MigrationDiagnostic {
  blobBytes: number
  booksWithProgress: number
  booksWithAnnotations: number
}

export type MigrationPreflightResult = {
  ok: true
  summary: MigrationSummary
  settings: Record<string, unknown>
  diagnostic: MigrationDiagnostic
} | {
  ok: false
  error: {
    code: MigrationPreflightErrorCode
    message: string
    diagnostic: MigrationDiagnostic
  }
}

export function normalizeReaderSettings(value: unknown): {
  settings: Record<string, unknown>
  warnings: string[]
} {
  const source = isRecord(value) ? value : {}
  const settings: Record<string, unknown> = { ...DEFAULT_READER_SETTINGS, ...source }
  const warnings: string[] = []
  const accept = (key: keyof typeof DEFAULT_READER_SETTINGS, valid: boolean) => {
    if (valid) return
    settings[key] = DEFAULT_READER_SETTINGS[key]
    if (Object.hasOwn(source, key)) warnings.push(key)
  }

  accept('theme', ['paper', 'light', 'sepia', 'dark'].includes(String(source.theme ?? settings.theme)))
  accept('flow', ['paginated', 'scrolled'].includes(String(source.flow ?? settings.flow)))
  accept('font', ['serif', 'sans', 'system'].includes(String(source.font ?? settings.font)))
  accept('fontSize', finiteRange(source.fontSize ?? settings.fontSize, 14, 32))
  accept('lineHeight', finiteRange(source.lineHeight ?? settings.lineHeight, 1.3, 2.2))
  accept('pageWidth', finiteRange(source.pageWidth ?? settings.pageWidth, 520, 1000))
  accept('headerCollapsed', typeof (source.headerCollapsed ?? settings.headerCollapsed) === 'boolean')
  accept('aiEndpoint', typeof (source.aiEndpoint ?? settings.aiEndpoint) === 'string')
  accept('aiModel', typeof (source.aiModel ?? settings.aiModel) === 'string')
  accept('aiApiKey', typeof (source.aiApiKey ?? settings.aiApiKey) === 'string')
  return { settings, warnings }
}

export async function inspectMigrationSnapshot(snapshot: MigrationSnapshot): Promise<MigrationPreflightResult> {
  const parsedSettings = parseSettings(snapshot.rawSettings)
  const normalized = normalizeReaderSettings(parsedSettings.value)
  const settingsWarnings = [...parsedSettings.warnings, ...normalized.warnings]
  const settingsKeys = isRecord(parsedSettings.value) ? Object.keys(parsedSettings.value).sort() : []
  const schemaVersion = schemaVersionOf(snapshot.schema)
  const diagnostic: MigrationDiagnostic = {
    databaseExists: snapshot.databaseExists,
    databaseVersion: snapshot.databaseVersion,
    stores: [...snapshot.stores].sort(),
    schemaVersion,
    bookCount: snapshot.books.length,
    settingsKey: SETTINGS_KEY,
    settingsKeys,
    settingsWarnings,
  }

  if (!snapshot.databaseExists) return success(diagnostic, normalized.settings, snapshot.books)
  if ((snapshot.databaseVersion ?? 0) > EXPECTED_DATABASE_VERSION) {
    return failure('database-version-newer', '数据库由更新版本的扩展创建', diagnostic)
  }
  if (snapshot.databaseVersion !== EXPECTED_DATABASE_VERSION) {
    return failure('database-version-unsupported', '数据库版本不受当前扩展支持', diagnostic)
  }
  const missingStore = REQUIRED_STORES.find(store => !snapshot.stores.includes(store))
  if (missingStore) return failure('missing-store', `数据库缺少 ${missingStore} 对象仓库`, diagnostic)
  if (!isRecord(snapshot.schema)) return failure('missing-schema', '数据库缺少 schema 元数据', diagnostic)
  if (schemaVersion !== EXPECTED_DATABASE_VERSION) {
    return failure('schema-version-mismatch', '数据库 schema 元数据与实际版本不一致', diagnostic)
  }

  for (const book of snapshot.books) {
    if (!isValidBook(book)) return failure('invalid-book', '书籍记录缺少迁移所需字段', diagnostic)
    if (!(book.blob instanceof Blob)) return failure('unreadable-book-blob', '书籍文件数据不可读取', diagnostic)
    try {
      await book.blob.slice(0, Math.min(1, book.blob.size)).arrayBuffer()
    } catch {
      return failure('unreadable-book-blob', '书籍文件数据不可读取', diagnostic)
    }
  }

  return success(diagnostic, normalized.settings, snapshot.books)
}

function success(
  diagnostic: MigrationDiagnostic,
  settings: Record<string, unknown>,
  books: unknown[],
): MigrationPreflightResult {
  const records = books.filter(isRecord)
  return {
    ok: true,
    settings,
    diagnostic,
    summary: {
      ...diagnostic,
      blobBytes: records.reduce((total, book) => total + (book.blob instanceof Blob ? book.blob.size : 0), 0),
      booksWithProgress: records.filter(book => isRecord(book.progress)).length,
      booksWithAnnotations: records.filter(book => Array.isArray(book.annotations) && book.annotations.length > 0).length,
    },
  }
}

function failure(
  code: MigrationPreflightErrorCode,
  message: string,
  diagnostic: MigrationDiagnostic,
): MigrationPreflightResult {
  return { ok: false, error: { code, message, diagnostic } }
}

function parseSettings(rawSettings: string | null): { value: unknown, warnings: string[] } {
  if (rawSettings === null) return { value: {}, warnings: [] }
  try {
    return { value: JSON.parse(rawSettings), warnings: [] }
  } catch {
    return { value: {}, warnings: ['settings-json'] }
  }
}

function isValidBook(value: unknown): value is Record<string, unknown> & { blob: unknown } {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && value.id.length > 0
    && typeof value.name === 'string' && value.name.length > 0
    && typeof value.format === 'string' && ['pdf', 'epub', 'mobi', 'azw3'].includes(value.format)
    && Number.isFinite(value.size) && Number(value.size) >= 0
    && Number.isFinite(value.lastModified)
    && Number.isFinite(value.openedAt)
    && Object.hasOwn(value, 'blob')
}

function schemaVersionOf(value: unknown): number | null {
  return isRecord(value) && Number.isSafeInteger(value.version) ? Number(value.version) : null
}

function finiteRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
