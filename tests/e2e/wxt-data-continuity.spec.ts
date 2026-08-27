import { expect, test, type Frame, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'
// @ts-expect-error The release allowlist is a JavaScript build helper without declarations.
import { releaseFiles } from '../../scripts/release-files.mjs'

const projectRoot = resolve('.')
const wxtExtension = resolve('.output/chrome-mv3')
const bookPath = resolve('tests/fixtures/books/alice.epub')

test('@wxt-data root → WXT → root preserves and extends the same local library', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'quiet-reader-continuity-'))
  const profile = join(workspace, 'edge-profile')
  const extension = join(workspace, 'unpacked-extension')
  let rootId = ''
  try {
    await stageRootExtension(extension)
    const root = await launchExtension(extension, { userDataDir: profile })
    try {
      rootId = root.extensionId
      await root.page.locator('#file-input').setInputFiles(bookPath)
      await expect(root.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
      await root.page.locator('#toc button').nth(3).evaluate((button: HTMLElement) => button.click())
      await selectText(await chapterFrame(root.page))
      await root.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      root.page.once('dialog', dialog => dialog.accept('Root annotation'))
      await root.page.locator('#note-selection').click()
      await expect(root.page.locator('.annotation-item')).toContainText('Root annotation')
      await root.page.locator('[data-theme="sepia"]').evaluate((button: HTMLElement) => button.click())
      await root.page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
      await expect(root.page.locator('#welcome-view')).toBeVisible()
      await root.page.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}')
        localStorage.setItem('quiet-reader-settings', JSON.stringify({
          ...settings,
          continuityMarker: 'root-created',
          aiApiKey: 'local-secret-must-stay-local',
        }))
      })
    } finally {
      await root.context.close()
    }

    const rootState = await readStateFromFreshLaunch(extension, profile, rootId)
    expect(rootState.schema.version).toBe(2)
    expect(rootState.books).toHaveLength(1)
    expect(rootState.books[0].annotations[0].note).toBe('Root annotation')
    expect(rootState.settings).toMatchObject({ theme: 'sepia', continuityMarker: 'root-created' })

    await stageWxtExtension(extension)
    const wxt = await launchExtension(extension, { userDataDir: profile, extensionId: rootId })
    let wxtState
    try {
      expect(wxt.extensionId).toBe(rootId)
      await expect(wxt.page.locator('html')).toHaveAttribute('data-migration-preflight', 'ready')
      await expect(wxt.page.locator('.library-card')).toHaveCount(1)
      wxtState = await readContinuityState(wxt.page)
      expect(wxtState.books[0].blobSha256).toBe(rootState.books[0].blobSha256)
      expect(wxtState.books[0].progress).toEqual(rootState.books[0].progress)
      expect(wxtState.books[0].annotations).toEqual(rootState.books[0].annotations)
      expect(wxtState.settings).toMatchObject({
        theme: 'sepia',
        continuityMarker: 'root-created',
        aiApiKey: 'local-secret-must-stay-local',
      })

      await wxt.page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
      await expect(wxt.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
      await wxt.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      await expect(wxt.page.locator('.annotation-item')).toContainText('Root annotation')
      const replies = ['WXT annotation', 'continuity, migrated']
      wxt.page.on('dialog', dialog => dialog.accept(replies.shift() || ''))
      await wxt.page.locator('.annotation-edit').click()
      await expect(wxt.page.locator('.annotation-item')).toContainText('WXT annotation')
      const initialProgress = Number(await wxt.page.locator('#progress-slider').inputValue())
      await wxt.page.locator('#toc button').nth(5).evaluate((button: HTMLElement) => button.click())
      await expect.poll(async () => Number(await wxt.page.locator('#progress-slider').inputValue())).not.toBe(initialProgress)
      await wxt.page.locator('[data-theme="dark"]').evaluate((button: HTMLElement) => button.click())
      await wxt.page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
      await expect(wxt.page.locator('#welcome-view')).toBeVisible()
      await wxt.page.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}')
        localStorage.setItem('quiet-reader-settings', JSON.stringify({ ...settings, continuityMarker: 'wxt-updated' }))
      })
      wxtState = await readContinuityState(wxt.page)
    } finally {
      await wxt.context.close()
    }

    await stageRootExtension(extension)
    const rollback = await launchExtension(extension, { userDataDir: profile, extensionId: rootId })
    try {
      expect(rollback.extensionId).toBe(rootId)
      await expect(rollback.page.locator('.library-card')).toHaveCount(1)
      const rollbackState = await readContinuityState(rollback.page)
      expect(rollbackState.version).toBe(2)
      expect(rollbackState.schema.version).toBe(2)
      expect(rollbackState.books[0].blobSha256).toBe(rootState.books[0].blobSha256)
      expect(rollbackState.books[0].progress).toEqual(wxtState.books[0].progress)
      expect(rollbackState.books[0].annotations).toEqual(wxtState.books[0].annotations)
      expect(rollbackState.books[0].annotations[0]).toMatchObject({
        note: 'WXT annotation',
        tags: ['continuity', 'migrated'],
      })
      expect(rollbackState.settings).toMatchObject({ theme: 'dark', continuityMarker: 'wxt-updated' })
      await rollback.page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
      await expect(rollback.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
      await rollback.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      await expect(rollback.page.locator('.annotation-item')).toContainText('WXT annotation')
    } finally {
      await rollback.context.close()
    }
  } finally {
    await removeOwnedWorkspace(workspace)
  }
})

test('@wxt-data failed WXT preflight preserves a damaged schema and blocks startup', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'quiet-reader-continuity-'))
  const profile = join(workspace, 'edge-profile')
  const extension = join(workspace, 'unpacked-extension')
  try {
    await stageRootExtension(extension)
    const root = await launchExtension(extension, { userDataDir: profile })
    const extensionId = root.extensionId
    try {
      await root.page.evaluate(corruptSchema)
    } finally {
      await root.context.close()
    }

    await stageWxtExtension(extension)
    const wxt = await launchExtension(extension, {
      userDataDir: profile,
      waitForSelector: null,
      extensionId,
    })
    try {
      await expect(wxt.page.locator('html')).toHaveAttribute('data-migration-preflight', 'failed')
      await expect(wxt.page.locator('#migration-error-view')).toBeVisible()
      await expect(wxt.page.locator('#welcome-view')).toHaveCount(0)
      await expect(wxt.page.locator('#migration-export-diagnostic')).toBeVisible()
      const state = await readContinuityState(wxt.page)
      expect(state.version).toBe(2)
      expect(state.schema).toEqual({ key: 'schema', version: 1, marker: 'do-not-rewrite' })
      expect(state.books).toHaveLength(1)
      expect(state.books[0].id).toBe('preflight-sentinel')
    } finally {
      await wxt.context.close()
    }
  } finally {
    await removeOwnedWorkspace(workspace)
  }
})

async function readStateFromFreshLaunch(extensionPath: string, profile: string, extensionId: string) {
  const launched = await launchExtension(extensionPath, { userDataDir: profile, extensionId })
  try {
    return await readContinuityState(launched.page)
  } finally {
    await launched.context.close()
  }
}

async function readContinuityState(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('quiet-reader')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(['books', 'meta'], 'readonly')
    const books = await new Promise<any[]>((resolve, reject) => {
      const request = transaction.objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const schema = await new Promise<any>((resolve, reject) => {
      const request = transaction.objectStore('meta').get('schema')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const summarizedBooks = await Promise.all(books.map(async book => ({
      id: book.id,
      name: book.name,
      size: book.size,
      progress: book.progress,
      annotations: book.annotations,
      blobSha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await book.blob.arrayBuffer()))]
        .map(byte => byte.toString(16).padStart(2, '0')).join(''),
    })))
    const result = {
      version: database.version,
      stores: Array.from(database.objectStoreNames),
      schema,
      books: summarizedBooks,
      settings: JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}'),
    }
    database.close()
    return result
  })
}

async function corruptSchema() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader', 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = database.transaction(['books', 'meta'], 'readwrite')
  transaction.objectStore('meta').put({ key: 'schema', version: 1, marker: 'do-not-rewrite' })
  transaction.objectStore('books').put({
    id: 'preflight-sentinel',
    name: 'Sentinel.epub',
    type: 'application/epub+zip',
    size: 8,
    lastModified: 1,
    openedAt: 2,
    format: 'epub',
    blob: new Blob(['sentinel']),
  })
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function selectText(frame: Frame) {
  await frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && (node.textContent || '').trim().length <= 24) node = walker.nextNode()
    if (!node) throw new Error('No selectable chapter text')
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, Math.min(32, node.textContent?.length || 0))
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function chapterFrame(page: Page): Promise<Frame> {
  let match: Frame | undefined
  await expect.poll(async () => {
    for (const candidate of page.frames().filter(frame => frame !== page.mainFrame())) {
      const text = await candidate.locator('body').innerText().catch(() => '')
      if (text.length > 200 && /Alice/i.test(text)) {
        match = candidate
        return true
      }
    }
    return false
  }).toBe(true)
  if (!match) throw new Error('No readable EPUB chapter frame')
  return match
}

async function stageRootExtension(target: string) {
  await replaceStage(target)
  for (const path of releaseFiles) {
    await cp(resolve(projectRoot, path), resolve(target, path), { recursive: true })
  }
}

async function stageWxtExtension(target: string) {
  await replaceStage(target)
  await cp(wxtExtension, target, { recursive: true })
}

async function replaceStage(target: string) {
  await rm(target, { recursive: true, force: true, maxRetries: 3 })
  await mkdir(target, { recursive: true })
}

async function removeOwnedWorkspace(workspace: string) {
  const expectedPrefix = join(tmpdir(), 'quiet-reader-continuity-').toLowerCase()
  if (!resolve(workspace).toLowerCase().startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove an unexpected workspace: ${workspace}`)
  }
  await rm(workspace, { recursive: true, force: true, maxRetries: 3 })
}
