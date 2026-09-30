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
      const rootInitialProgress = Number(await root.page.locator('#progress-slider').inputValue())
      await root.page.locator('#toc button').nth(3).evaluate((button: HTMLElement) => button.click())
      await expect.poll(async () => Number(await root.page.locator('#progress-slider').inputValue())).not.toBe(rootInitialProgress)
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
      await expect.poll(async () => (await readContinuityState(root.page)).books[0]?.progress?.fraction ?? 0)
        .toBeGreaterThan(0)
    } finally {
      await root.context.close()
    }

    const rootState = await readStateFromFreshLaunch(extension, profile, rootId)
    expect(rootState.schema.version).toBe(2)
    expect(rootState.books).toHaveLength(1)
    expect(rootState.books[0].annotations[0].note).toBe('Root annotation')
    expect(rootState.books[0].progress).toMatchObject({ kind: 'ebook' })
    expect(rootState.books[0].progress.fraction).toBeGreaterThan(0)
    expect(rootState.settings).toMatchObject({ theme: 'sepia', continuityMarker: 'root-created' })

    await stageWxtExtension(extension)
    const wxt = await launchExtension(extension, { userDataDir: profile, extensionId: rootId })
    let wxtState
    try {
      expect(wxt.extensionId).toBe(rootId)
      await expect(wxt.page.locator('html')).toHaveAttribute('data-migration-preflight', 'ready')
      await expect(wxt.page.locator('html')).toHaveAttribute('data-legacy-controller', 'ready')
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
      await expect.poll(async () => Number(await wxt.page.locator('#progress-slider').inputValue()))
        .toBeCloseTo(rootState.books[0].progress.fraction, 3)
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
      await expect.poll(async () => (await readContinuityState(wxt.page)).books[0]?.progress?.fraction)
        .not.toBe(rootState.books[0].progress.fraction)
      wxtState = await readContinuityState(wxt.page)
      expect(wxtState.books[0].progress).toMatchObject({ kind: 'ebook' })
      expect(wxtState.books[0].progress.fraction).not.toBe(rootState.books[0].progress.fraction)
    } finally {
      await wxt.context.close()
    }

    await stageRootExtension(extension)
    const rollback = await launchExtension(extension, { userDataDir: profile, extensionId: rootId })
    try {
      expect(rollback.extensionId).toBe(rootId)
      await expect(rollback.page.locator('html')).not.toHaveAttribute('data-migration-preflight', /.+/)
      await expect(rollback.page.locator('.library-card')).toHaveCount(1)
      const rollbackState = await readContinuityState(rollback.page)
      expect(rollbackState.version).toBe(2)
      expect(rollbackState.schema.version).toBe(2)
      expect(rollbackState.books[0].blobSha256).toBe(rootState.books[0].blobSha256)
      expect(rollbackState.books[0].progress).toEqual(wxtState.books[0].progress)
      expect(rollbackState.books[0].annotations).toEqual(wxtState.books[0].annotations)
      expect(rollbackState.books[0].annotations[0]).toMatchObject({
        note: 'Root annotation',
      })
      expect(rollbackState.settings).toMatchObject({ theme: 'dark', continuityMarker: 'wxt-updated' })
      await rollback.page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
      await expect(rollback.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
      await expect.poll(async () => Number(await rollback.page.locator('#progress-slider').inputValue()))
        .toBeCloseTo(wxtState.books[0].progress.fraction, 3)
      await rollback.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      await expect(rollback.page.locator('.annotation-item')).toContainText('Root annotation')
    } finally {
      await rollback.context.close()
    }
  } finally {
    await removeOwnedWorkspace(workspace)
  }
})

test('@wxt-data PDF root → WXT → root renders persisted pages without changing ebook data', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'quiet-reader-continuity-'))
  const profile = join(workspace, 'edge-profile')
  const extension = join(workspace, 'unpacked-extension')
  try {
    await stageRootExtension(extension)
    const root = await launchExtension(extension, { userDataDir: profile })
    const extensionId = root.extensionId
    let rootState: any
    try {
      await root.page.locator('#file-input').setInputFiles(bookPath)
      await expect(root.page.locator('#loading-view')).toBeHidden()
      await root.page.locator('#toc button').nth(3).evaluate((button: HTMLElement) => button.click())
      await selectText(await chapterFrame(root.page))
      await root.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      root.page.once('dialog', dialog => dialog.accept('Untouched ebook annotation'))
      await root.page.locator('#note-selection').click()
      await expect(root.page.locator('.annotation-item')).toContainText('Untouched ebook annotation')
      await root.page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
      await expect(root.page.locator('#welcome-view')).toBeVisible()
      await root.page.locator('#file-input').setInputFiles(resolve('tests/fixtures/books/tracemonkey.pdf'))
      await expect(root.page.locator('#loading-view')).toBeHidden()
      await jumpPdf(root.page, 4)
      await renderedPdfPage(root.page, 4)
      await root.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      await root.page.locator('.pdf-page[data-page="4"] .textLayer').evaluate((textLayer: HTMLElement) => {
        const span = [...textLayer.querySelectorAll('span')].find(item => (item.textContent || '').trim().length >= 12)
        if (!span?.firstChild) throw new Error('No selectable PDF span on page 4')
        const range = document.createRange()
        range.selectNodeContents(span.firstChild)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        textLayer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      root.page.once('dialog', dialog => dialog.accept('Root PDF note'))
      await root.page.locator('#note-selection').click()
      await expect(root.page.locator('#annotation-list')).toContainText('Root PDF note')
      await root.page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
      await expect.poll(async () => (await readContinuityState(root.page)).books.find((book: any) => book.format === 'pdf')?.progress?.page).toBe(4)
      rootState = await readContinuityState(root.page)
      expect(rootState.books.find((book: any) => book.format === 'epub').progress.fraction).toBeGreaterThan(0)
      expect(root.pageErrors.map(error => error.stack || error.message)).toEqual([])
    } finally { await root.context.close() }

    const rootPdf = rootState.books.find((book: any) => book.format === 'pdf')
    const rootEbook = rootState.books.find((book: any) => book.format === 'epub')
    let wxtState: any
    await stageWxtExtension(extension)
    const wxt = await launchExtension(extension, { userDataDir: profile, extensionId })
    try {
      expect(wxt.extensionId).toBe(extensionId)
      await expect(wxt.page.locator('html')).toHaveAttribute('data-migration-preflight', 'ready')
      const state = await readContinuityState(wxt.page)
      expect(state.version).toBe(2)
      expect(state.schema).toEqual(rootState.schema)
      expect(state.books).toEqual(rootState.books)
      await wxt.page.locator('.library-card').filter({ hasText: /tracemonkey/i }).click()
      await expect(wxt.page.locator('#loading-view')).toBeHidden()
      await renderedPdfPage(wxt.page, 4)
      await wxt.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      await expect(wxt.page.locator('#annotation-list')).toContainText('Root PDF note')
      await jumpPdf(wxt.page, 9)
      await renderedPdfPage(wxt.page, 9)
      await wxt.page.locator('.pdf-page[data-page="9"] .textLayer').evaluate((textLayer: HTMLElement) => {
        const span = [...textLayer.querySelectorAll('span')].find(item => (item.textContent || '').trim().length >= 12)
        if (!span?.firstChild) throw new Error('No selectable PDF span on page 9')
        const range = document.createRange()
        range.selectNodeContents(span.firstChild)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        textLayer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      await wxt.page.locator('#highlight-selection').click()
      await expect(wxt.page.locator('#annotation-list .annotation-item')).toHaveCount(2)
      await wxt.page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
      await expect.poll(async () => (await readContinuityState(wxt.page)).books.find((book: any) => book.format === 'pdf')?.progress?.page).toBe(9)
      wxtState = await readContinuityState(wxt.page)
      expect(wxtState.books.find((book: any) => book.format === 'epub')).toEqual(rootEbook)
      const pdf = wxtState.books.find((book: any) => book.format === 'pdf')
      expect(pdf.blobSha256).toBe(rootPdf.blobSha256)
      expect(pdf.annotations).toHaveLength(2)
      expect(pdf.annotations).toEqual(expect.arrayContaining([expect.objectContaining({ note: 'Root PDF note' })]))
      expect(wxt.pageErrors.map(error => error.stack || error.message)).toEqual([])
    } finally { await wxt.context.close() }

    await stageRootExtension(extension)
    const rollback = await launchExtension(extension, { userDataDir: profile, extensionId })
    try {
      expect(rollback.extensionId).toBe(extensionId)
      const state = await readContinuityState(rollback.page)
      expect(state.version).toBe(2)
      expect(state.schema).toEqual(rootState.schema)
      expect(state.books).toEqual(wxtState.books)
      expect(state.books.find((book: any) => book.format === 'epub')).toEqual(rootEbook)
      await rollback.page.locator('.library-card').filter({ hasText: /tracemonkey/i }).click()
      await expect(rollback.page.locator('#loading-view')).toBeHidden()
      await renderedPdfPage(rollback.page, 9)
      await rollback.page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      await expect(rollback.page.locator('#annotation-list .annotation-item')).toHaveCount(2)
      await expect(rollback.page.locator('#annotation-list')).toContainText('Root PDF note')
      expect(rollback.pageErrors.map(error => error.stack || error.message)).toEqual([])
    } finally { await rollback.context.close() }
  } finally { await removeOwnedWorkspace(workspace) }
})

async function jumpPdf(page: Page, value: number) {
  await page.locator('#pdf-page-input').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value)
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function renderedPdfPage(page: Page, value: number) {
  await expect(page.locator('#pdf-page-input')).toHaveValue(String(value))
  await expect(page.locator('#pdf-page-total')).toHaveText('/ 14')
  await expect(page.locator(`.pdf-page[data-page="${value}"] .textLayer`)).not.toBeEmpty()
  await expect(page.locator('#chapter-label')).toContainText(`第 ${value} 页`)
}

test('@wxt-data failed WXT preflight preserves a damaged schema and blocks startup', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'quiet-reader-continuity-'))
  const profile = join(workspace, 'edge-profile')
  const extension = join(workspace, 'unpacked-extension')
  try {
    await stageRootExtension(extension)
    const root = await launchExtension(extension, { userDataDir: profile })
    const extensionId = root.extensionId
    let beforeFailure
    try {
      await root.page.evaluate(corruptSchema)
      beforeFailure = await readContinuityState(root.page)
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
      await expect(wxt.page.locator('html')).not.toHaveAttribute('data-legacy-controller', /.+/)
      expect(wxt.pageErrors).toEqual([])
      const state = await readContinuityState(wxt.page)
      expect(state).toEqual(beforeFailure)
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
    const summarizedBooks = await Promise.all(books.map(async book => {
      const { blob, ...fields } = book
      return {
        ...fields,
        blobSha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
          .map(byte => byte.toString(16).padStart(2, '0')).join(''),
      }
    }))
    const result = {
      version: database.version,
      stores: Array.from(database.objectStoreNames),
      schema,
      books: summarizedBooks,
      settings: JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}'),
      rawSettings: localStorage.getItem('quiet-reader-settings'),
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
