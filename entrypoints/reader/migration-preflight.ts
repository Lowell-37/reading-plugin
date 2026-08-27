import {
  inspectMigrationSnapshot,
  type MigrationPreflightResult,
  type MigrationSnapshot,
} from '../../src/core/migration-preflight'
// @ts-expect-error JavaScript compatibility schema constants have no declaration file yet.
import { BOOKS_STORE, DB_NAME, META_STORE } from '../../src/storage-schema.js'

export async function runMigrationPreflight(): Promise<MigrationPreflightResult> {
  try {
    return await inspectMigrationSnapshot(await readMigrationSnapshot())
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      ok: false,
      error: {
        code: 'database-open-failed',
        message: '无法只读检查本地书库，请先导出诊断并保留原数据',
        diagnostic: {
          databaseExists: true,
          databaseVersion: null,
          stores: [],
          schemaVersion: null,
          bookCount: 0,
          settingsKey: 'quiet-reader-settings',
          settingsKeys: [],
          settingsWarnings: [`database-open:${message}`],
        },
      },
    }
  }
}

async function readMigrationSnapshot(): Promise<MigrationSnapshot> {
  const databases = await indexedDB.databases()
  const descriptor = databases.find(database => database.name === DB_NAME)
  const rawSettings = localStorage.getItem('quiet-reader-settings')
  if (!descriptor) {
    return {
      databaseExists: false,
      databaseVersion: null,
      stores: [],
      schema: null,
      books: [],
      rawSettings,
    }
  }

  const database = await openExistingDatabase()
  try {
    const stores = Array.from(database.objectStoreNames)
    if (!stores.includes(BOOKS_STORE) || !stores.includes(META_STORE)) {
      return {
        databaseExists: true,
        databaseVersion: database.version,
        stores,
        schema: null,
        books: [],
        rawSettings,
      }
    }
    const transaction = database.transaction([BOOKS_STORE, META_STORE], 'readonly')
    const booksRequest = transaction.objectStore(BOOKS_STORE).getAll()
    const schemaRequest = transaction.objectStore(META_STORE).get('schema')
    const [books, schema] = await Promise.all([
      requestResult<unknown[]>(booksRequest),
      requestResult<unknown>(schemaRequest),
      transactionComplete(transaction),
    ])
    return {
      databaseExists: true,
      databaseVersion: database.version,
      stores,
      schema,
      books,
      rawSettings,
    }
  } finally {
    database.close()
  }
}

function openExistingDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      reject(new Error('Read-only preflight refused to create a database'))
    }
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
