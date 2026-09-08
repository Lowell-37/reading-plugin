import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'

const wxtExtension = resolve('.output/chrome-mv3')
const booksPath = resolve('tests/fixtures/books')

test.describe('@wxt-session', () => {
  for (const format of ['epub', 'mobi', 'azw3'] as const) {
    test(`WXT Vue session reads real ${format.toUpperCase()} content and restores it`, async () => {
      const { context, page, pageErrors } = await launchExtension(wxtExtension)
      try {
        await openBook(page, `alice.${format}`)
        await expect(page.locator('#reader-view')).toHaveClass(/ebook-session-active/)
        await expect(page.locator('#header-title')).toContainText(/Alice/i)
        await expect.poll(() => foliateContentDocumentCount(page)).toBeGreaterThan(0)

        await page.locator('#sidebar-button').evaluate((button: HTMLElement) => button.click())
        await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(5)
        const initialProgress = await progress(page)
        await page.locator('#toc button').nth(5).evaluate((button: HTMLElement) => button.click())
        await expect.poll(() => progress(page)).toBeGreaterThan(initialProgress)
        await expect.poll(() => foliateContentText(page)).toMatch(/Alice|Rabbit|Wonderland/i)

        const afterToc = await progress(page)
        await page.locator('#prev-button').evaluate((button: HTMLElement) => button.click())
        await expect.poll(() => progress(page)).toBeLessThan(afterToc)
        await page.locator('#next-button').evaluate((button: HTMLElement) => button.click())
        await expect.poll(() => progress(page)).toBeGreaterThan(0)

        await page.locator('#settings-button').evaluate((button: HTMLElement) => button.click())
        await page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
        await expect(page.locator('.continuous-ebook')).toBeVisible()
        await page.locator('[data-flow="paginated"]').evaluate((button: HTMLElement) => button.click())
        await expect(page.locator('.continuous-ebook')).toHaveCount(0)
        await page.locator('#close-settings').evaluate((button: HTMLElement) => button.click())
        await expect.poll(() => storedProgress(page)).toBeGreaterThan(0)
        const savedProgress = await storedProgress(page)

        await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
        await expect(page.locator('#welcome-view')).toBeVisible()
        await page.reload()
        await page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
        await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
        await expect(page.locator('#header-title')).toContainText(/Alice/i)
        await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(savedProgress * 0.8)
        expect(pageErrors.map(pageErrorDetails)).toEqual([])
      } finally {
        await context.close()
      }
    })
  }

  test('WXT keeps only the newest real EPUB session after rapid sequential opening', async () => {
    const { context, page, pageErrors } = await launchExtension(wxtExtension)
    try {
      await page.locator('#file-input').setInputFiles(resolve(booksPath, 'alice.epub'))
      await page.locator('#file-input').setInputFiles(resolve(booksPath, 'boundaries.epub'))
      await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
      await expect(page.locator('#header-title')).toContainText(/Boundary|边界|boundaries/i)
      await page.locator('#sidebar-button').evaluate((button: HTMLElement) => button.click())
      await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(1)
      await page.locator('#toc button').last().evaluate((button: HTMLElement) => button.click())
      await expect.poll(() => progress(page)).toBeGreaterThan(0)
      await expect.poll(async () => page.locator('.library-card').count()).toBe(2)
      await expect.poll(async () => (await storedBookProgresses(page))[0]?.progress || 0)
        .toBeGreaterThan(0)
      const progresses = await storedBookProgresses(page)
      expect(progresses.map(record => record.name)).toEqual(['boundaries.epub', 'alice.epub'])
      expect(progresses[0]?.progress).toBeGreaterThan(0)
      expect(progresses[1]?.progress).toBe(0)
      expect(pageErrors.map(pageErrorDetails)).toEqual([])
    } finally {
      await context.close()
    }
  })
})

async function openBook(page: Page, name: string) {
  await page.locator('#file-input').setInputFiles(resolve(booksPath, name))
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}

async function foliateContentText(page: Page) {
  return page.evaluate(() => {
    type FoliateContent = { doc?: Document | null }
    type FoliateViewElement = HTMLElement & {
      getContents?: () => FoliateContent[]
      renderer?: { getContents?: () => FoliateContent[] }
    }
    const view = document.querySelector<FoliateViewElement>('#ebook-host foliate-view')
    const contents = view?.getContents?.() ?? view?.renderer?.getContents?.() ?? []
    return contents
      .map(content => content.doc?.body?.innerText || content.doc?.body?.textContent || '')
      .join('\n')
      .trim()
  })
}

async function foliateContentDocumentCount(page: Page) {
  return page.evaluate(() => {
    type FoliateContent = { doc?: Document | null }
    type FoliateViewElement = HTMLElement & {
      getContents?: () => FoliateContent[]
      renderer?: { getContents?: () => FoliateContent[] }
    }
    const view = document.querySelector<FoliateViewElement>('#ebook-host foliate-view')
    return (view?.getContents?.() ?? view?.renderer?.getContents?.() ?? [])
      .filter(content => content.doc?.documentElement)
      .length
  })
}

async function storedProgress(page: Page) {
  const records = await storedBookProgresses(page)
  return records[0]?.progress || 0
}

async function storedBookProgresses(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open('quiet-reader', 2)
      request.onsuccess = () => resolveDatabase(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<Array<{ name: string, progress: number }>>((resolveRecords, reject) => {
        const request = database.transaction('books', 'readonly').objectStore('books').getAll()
        request.onsuccess = () => resolveRecords(request.result
          .sort((left: { openedAt?: number }, right: { openedAt?: number }) => Number(right.openedAt) - Number(left.openedAt))
          .map((record: { name: string, progress?: { fraction?: number } }) => ({
            name: record.name,
            progress: Number(record.progress?.fraction) || 0,
          })))
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })
}

function pageErrorDetails(error: Error) {
  return error.stack || error.message
}
