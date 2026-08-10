export const DB_NAME = 'quiet-reader'
export const DB_VERSION = 2
export const BOOKS_STORE = 'books'
export const META_STORE = 'meta'

const migrations = new Map([
  [1, database => {
    if (database.objectStoreNames.contains(BOOKS_STORE)) return
    const store = database.createObjectStore(BOOKS_STORE, { keyPath: 'id' })
    store.createIndex('openedAt', 'openedAt')
  }],
  [2, (database, transaction) => {
    const store = database.objectStoreNames.contains(META_STORE)
      ? transaction.objectStore(META_STORE)
      : database.createObjectStore(META_STORE, { keyPath: 'key' })
    store.put({ key: 'schema', version: 2, migratedAt: new Date().toISOString() })
  }],
])

export function applySchemaMigrations(database, transaction, oldVersion, newVersion = DB_VERSION) {
  if (!transaction) throw new Error('IndexedDB upgrade transaction is unavailable')
  try {
    for (let version = oldVersion + 1; version <= newVersion; version += 1) {
      const migrate = migrations.get(version)
      if (!migrate) throw new Error(`Missing database migration for version ${version}`)
      migrate(database, transaction)
    }
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // The browser may already have aborted the versionchange transaction.
    }
    throw error
  }
}

export function schemaRecord(version = DB_VERSION, migratedAt = new Date().toISOString()) {
  return { key: 'schema', version, migratedAt }
}
