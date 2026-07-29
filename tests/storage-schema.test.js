import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  applySchemaMigrations,
  BOOKS_STORE,
  DB_VERSION,
  META_STORE,
} from '../src/storage-schema.js'

function mockUpgrade(existingStores = []) {
  const stores = new Map(existingStores.map(name => [name, mockStore(name)]))
  const database = {
    objectStoreNames: {
      contains: name => stores.has(name),
    },
    created: [],
    createObjectStore(name, options) {
      const store = mockStore(name, options)
      stores.set(name, store)
      this.created.push({ name, options })
      return store
    },
  }
  const transaction = {
    aborted: false,
    objectStore(name) {
      const store = stores.get(name)
      if (!store) throw new Error(`Missing store ${name}`)
      return store
    },
    abort() {
      this.aborted = true
    },
  }
  return { database, transaction, stores }
}

function mockStore(name, options) {
  return {
    name,
    options,
    indexes: [],
    records: [],
    createIndex(indexName, keyPath) {
      this.indexes.push({ name: indexName, keyPath })
    },
    put(record) {
      this.records.push(record)
    },
  }
}

test('creates the complete v2 schema for a new database', () => {
  const { database, transaction, stores } = mockUpgrade()
  applySchemaMigrations(database, transaction, 0, DB_VERSION)

  assert.deepEqual(database.created.map(item => item.name), [BOOKS_STORE, META_STORE])
  assert.deepEqual(stores.get(BOOKS_STORE).indexes, [{ name: 'openedAt', keyPath: 'openedAt' }])
  assert.equal(stores.get(META_STORE).records[0].key, 'schema')
  assert.equal(stores.get(META_STORE).records[0].version, 2)
  assert.equal(transaction.aborted, false)
})

test('upgrades v1 without recreating or clearing the books store', () => {
  const { database, transaction, stores } = mockUpgrade([BOOKS_STORE])
  const originalBooksStore = stores.get(BOOKS_STORE)

  applySchemaMigrations(database, transaction, 1, 2)

  assert.deepEqual(database.created.map(item => item.name), [META_STORE])
  assert.equal(stores.get(BOOKS_STORE), originalBooksStore)
  assert.equal(stores.get(META_STORE).records[0].version, 2)
  assert.equal(transaction.aborted, false)
})

test('aborts the upgrade transaction when a migration is missing', () => {
  const { database, transaction } = mockUpgrade([BOOKS_STORE, META_STORE])

  assert.throws(
    () => applySchemaMigrations(database, transaction, 2, 3),
    /Missing database migration for version 3/,
  )
  assert.equal(transaction.aborted, true)
})
