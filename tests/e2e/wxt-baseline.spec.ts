import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'

const rootExtension = resolve('.')
const wxtExtension = resolve('.output/chrome-mv3')
const booksPath = resolve('tests/fixtures/books')

test.describe('@wxt', () => {
test('WXT build keeps the root extension identity and opens the reader shell', async () => {
  const root = await launchExtension(rootExtension)
  const rootExtensionId = root.extensionId
  await root.context.close()

  const wxt = await launchExtension(wxtExtension)
  try {
    expect(wxt.extensionId).toBe(rootExtensionId)
    await expect(wxt.page.locator('#welcome-view')).toBeVisible()
    await expect(wxt.page.locator('#file-input')).toHaveAttribute('accept', /\.epub/)
    await expect(wxt.page.locator('.ai-section')).toBeHidden()
    await expect(wxt.page.locator('[data-ai-action]').first()).toBeHidden()
    await expect(wxt.page.locator('#selection-ai-menu')).toBeHidden()
  } finally {
    await wxt.context.close()
  }
})

for (const format of ['epub', 'mobi', 'azw3'] as const) {
  test(`WXT opens a real ${format.toUpperCase()} with TOC and progress`, async () => {
    const { context, page } = await launchExtension(wxtExtension)
    try {
      await openBook(page, `alice.${format}`)
      await expect(page.locator('#sidebar-title')).toContainText(/Alice/i)
      await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(2)

      const initialProgress = await progress(page)
      const targetChapter = page.locator('#toc button').nth(2)
      await targetChapter.evaluate((element: HTMLElement) => element.click())
      await expect.poll(() => progress(page)).toBeGreaterThan(initialProgress)
    } finally {
      await context.close()
    }
  })
}

test('WXT renders a real PDF text layer, page jump and zoom', async () => {
  const { context, page } = await launchExtension(wxtExtension)
  try {
    await openBook(page, 'tracemonkey.pdf')
    await expect(page.locator('#ebook-host')).toBeHidden()
    await expect(page.locator('#pdf-page-total')).not.toHaveText('/ 1')
    await expect.poll(async () => page.locator('.textLayer span').count()).toBeGreaterThan(0)

    await page.locator('#pdf-zoom-in').evaluate((element: HTMLElement) => element.click())
    await expect(page.locator('#pdf-zoom-label')).toHaveText('110%')
    const initialProgress = await progress(page)
    await page.locator('#pdf-page-input').evaluate((input: HTMLInputElement) => {
      input.value = '3'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.locator('#pdf-page-input')).toHaveValue('3')
    await expect.poll(async () => page.locator('.pdf-page[data-page="3"] .textLayer span').count()).toBeGreaterThan(0)
    await expect(page.locator('#chapter-label')).toContainText('第 3 页')
    await expect.poll(() => progress(page)).toBeGreaterThan(initialProgress)
  } finally {
    await context.close()
  }
})

test('WXT switches and restores real EPUB flow, theme and progress', async () => {
  const { context, page } = await launchExtension(wxtExtension)
  try {
    await openBook(page, 'alice.epub')
    await expect(page.locator('.continuous-ebook')).toHaveCount(0)

    await page.locator('#settings-button').click()
    await expect(page.locator('#settings-panel')).toBeVisible()
    await page.locator('[data-flow="scrolled"]').click()
    await expect(page.locator('.continuous-ebook')).toBeVisible()

    await page.locator('[data-flow="paginated"]').click()
    await expect(page.locator('.continuous-ebook')).toHaveCount(0)
    await page.locator('[data-theme="dark"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.locator('[data-flow="scrolled"]').click()
    await expect(page.locator('.continuous-ebook')).toBeVisible()
    await page.locator('#close-settings').click()
    const initialProgress = await progress(page)
    const storedBeforeNavigation = await storedEbookProgress(page)
    await page.locator('#sidebar-button').click()
    await page.locator('#toc button').nth(3).click()
    await expect.poll(() => progress(page)).not.toBe(initialProgress)

    await page.locator('#scrim').click()
    await expect(page.locator('#scrim')).not.toHaveClass(/show/)
    await page.locator('#home-button').click()
    await expect(page.locator('#welcome-view')).toBeVisible()
    await expect.poll(() => storedEbookProgress(page)).not.toBeCloseTo(storedBeforeNavigation, 3)
    const savedProgress = await storedEbookProgress(page)
    await page.reload()
    await expect(page.locator('.library-card')).toHaveCount(1)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.locator('.library-card').click()
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('.continuous-ebook')).toBeVisible()
    await expect.poll(() => progress(page)).toBeGreaterThan(0)
    expect(await progress(page)).toBeCloseTo(savedProgress, 1)
  } finally {
    await context.close()
  }
})

async function openBook(page: Page, name: string) {
  await page.locator('#file-input').setInputFiles(resolve(booksPath, name))
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}

async function storedEbookProgress(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open('quiet-reader', 2)
      request.onsuccess = () => resolveDatabase(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolveProgress, reject) => {
        const request = database.transaction('books', 'readonly').objectStore('books').getAll()
        request.onsuccess = () => resolveProgress(Number(request.result[0]?.progress?.fraction) || 0)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })
}
})
