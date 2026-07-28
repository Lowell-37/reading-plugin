const DB_NAME = 'quiet-reader'
const DB_VERSION = 1
const BOOKS_STORE = 'books'

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function openDatabase() {
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(BOOKS_STORE)) {
      const store = database.createObjectStore(BOOKS_STORE, { keyPath: 'id' })
      store.createIndex('openedAt', 'openedAt')
    }
  }
  return requestToPromise(request)
}

export async function makeBookId(file) {
  const signature = new TextEncoder().encode(`${file.name}\u0000${file.size}\u0000${file.lastModified}`)
  const hash = await crypto.subtle.digest('SHA-256', signature)
  return Array.from(new Uint8Array(hash).slice(0, 12), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function saveBook(file, format) {
  const database = await openDatabase()
  const id = await makeBookId(file)
  const transaction = database.transaction(BOOKS_STORE, 'readwrite')
  const store = transaction.objectStore(BOOKS_STORE)
  const existing = await requestToPromise(store.get(id))
  const record = {
    ...existing,
    id,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
    format,
    blob: file,
    openedAt: Date.now(),
  }
  store.put(record)
  await transactionDone(transaction)
  database.close()
  return record
}

export async function updateBook(id, changes) {
  if (!id) return
  const database = await openDatabase()
  const transaction = database.transaction(BOOKS_STORE, 'readwrite')
  const store = transaction.objectStore(BOOKS_STORE)
  const existing = await requestToPromise(store.get(id))
  if (existing) store.put({ ...existing, ...changes })
  await transactionDone(transaction)
  database.close()
}

export async function listBooks() {
  const database = await openDatabase()
  const transaction = database.transaction(BOOKS_STORE, 'readonly')
  const result = await requestToPromise(transaction.objectStore(BOOKS_STORE).getAll())
  await transactionDone(transaction)
  database.close()
  return result.sort((a, b) => b.openedAt - a.openedAt)
}

export async function deleteBook(id) {
  const database = await openDatabase()
  const transaction = database.transaction(BOOKS_STORE, 'readwrite')
  transaction.objectStore(BOOKS_STORE).delete(id)
  await transactionDone(transaction)
  database.close()
}

export async function restoreBooks(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array')
  const database = await openDatabase()
  const transaction = database.transaction(BOOKS_STORE, 'readwrite')
  const store = transaction.objectStore(BOOKS_STORE)
  for (const record of records) store.put(record)
  await transactionDone(transaction)
  database.close()
  return records.length
}

const DEFAULT_SETTINGS = {
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
}

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('quiet-reader-settings')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  localStorage.setItem('quiet-reader-settings', JSON.stringify(settings))
}
