import { test, expect, chromium, type BrowserContext } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

test('root extension atomically upgrades a v1 library and preserves progress', async () => {
  const context = await launchRootExtension()
  try {
    let [worker] = context.serviceWorkers()
    worker ||= await context.waitForEvent('serviceworker')
    await worker.evaluate(seedVersionOneDatabase)

    const page = await context.newPage()
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`)
    await expect(page.locator('#welcome-view')).toBeVisible()
    await expect(page.locator('.library-card')).toHaveCount(1)
    await expect(page.locator('.library-card')).toContainText('Migration Test')

    const state = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('quiet-reader')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const transaction = database.transaction(['books', 'meta'], 'readonly')
      const book = await new Promise<any>((resolve, reject) => {
        const request = transaction.objectStore('books').get('legacy-book')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const schema = await new Promise<any>((resolve, reject) => {
        const request = transaction.objectStore('meta').get('schema')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const result = {
        version: database.version,
        stores: Array.from(database.objectStoreNames),
        schema,
        progress: book.progress,
        annotations: book.annotations,
      }
      database.close()
      return result
    })

    expect(state.version).toBe(2)
    expect(state.stores).toEqual(['books', 'meta'])
    expect(state.schema.version).toBe(2)
    expect(state.progress).toEqual({ fraction: 0.37, cfi: 'epubcfi(/6/4)' })
    expect(state.annotations).toEqual([{ id: 'legacy-note', text: 'Preserved' }])

    const rollbackState = await page.evaluate(async () => {
      const migrations = await import(new URL('src/storage-schema.js', location.href).href)
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('quiet-reader', 3)
        request.onupgradeneeded = event => {
          try {
            migrations.applySchemaMigrations(
              request.result,
              request.transaction,
              event.oldVersion,
              event.newVersion ?? 3,
            )
          } catch {
            // The missing v3 migration deliberately aborts this transaction.
          }
        }
        request.onsuccess = () => reject(new Error('Unexpected v3 migration success'))
        request.onerror = () => resolve()
      })

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('quiet-reader')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const transaction = database.transaction('books', 'readonly')
      const book = await new Promise<any>((resolve, reject) => {
        const request = transaction.objectStore('books').get('legacy-book')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const result = { version: database.version, progress: book.progress }
      database.close()
      return result
    })

    expect(rollbackState.version).toBe(2)
    expect(rollbackState.progress).toEqual({ fraction: 0.37, cfi: 'epubcfi(/6/4)' })
  } finally {
    await context.close()
  }
})

async function launchRootExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    executablePath: existsSync(edgePath) ? edgePath : undefined,
    channel: existsSync(edgePath) ? undefined : 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })
}

async function seedVersionOneDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('quiet-reader')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('books', { keyPath: 'id' })
      store.createIndex('openedAt', 'openedAt')
      store.put({
        id: 'legacy-book',
        name: 'Migration Test.epub',
        type: 'application/epub+zip',
        size: 12,
        lastModified: 1234,
        format: 'epub',
        openedAt: 5678,
        progress: { fraction: 0.37, cfi: 'epubcfi(/6/4)' },
        annotations: [{ id: 'legacy-note', text: 'Preserved' }],
        blob: new Blob(['legacy epub'], { type: 'application/epub+zip' }),
      })
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}
