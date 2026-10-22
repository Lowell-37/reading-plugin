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

        await page.locator('#sidebar-button').evaluate((button: HTMLElement) => button.click())
        const keyboardHandled = await page.evaluate(() => {
          const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
          window.dispatchEvent(event)
          return event.defaultPrevented
        })
        expect(keyboardHandled).toBe(true)

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

  for (const book of [
    {
      filename: 'frankenstein-gutenberg.mobi',
      title: /Frankenstein/i,
      format: 'MOBI',
      chapter: /^Chapter 24$/,
      passage: 'My present situation was one in which all voluntary thought was swallowed up and lost.',
      minimumProgress: 0.8,
    },
    {
      filename: 'dracula-standard-ebooks.azw3',
      title: /Dracula/i,
      format: 'AZW3',
      chapter: /^XXVII$/,
      passage: 'Mina Harker’s Journal',
      minimumProgress: 0.8,
    },
  ]) {
    test(`WXT restores a deep chapter in real ${book.format} from ${book.filename}`, async () => {
      const { context, page, pageErrors } = await launchExtension(wxtExtension)
      try {
        await openBook(page, book.filename)
        await expect(page.locator('#sidebar-title')).toContainText(book.title)
        await expect(page.locator('#sidebar-format')).toHaveText(book.format)
        await page.locator('#sidebar-button').evaluate((button: HTMLElement) => button.click())
        await expect.poll(() => page.locator('#toc button').count()).toBeGreaterThan(20)
        await page.locator('#toc button').filter({ hasText: book.chapter }).first()
          .evaluate((button: HTMLElement) => button.click())
        await expect.poll(() => foliateContentText(page)).toContain(book.passage)
        await expect.poll(() => progress(page)).toBeGreaterThan(book.minimumProgress)
        const savedProgress = await progress(page)

        await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
        await expect(page.locator('#welcome-view')).toBeVisible()
        await page.reload()
        await page.locator('.library-card').filter({ hasText: book.title }).first()
          .evaluate((card: HTMLElement) => card.click())
        await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
        await expect(page.locator('#sidebar-format')).toHaveText(book.format)
        await expect.poll(() => progress(page)).toBeCloseTo(savedProgress, 2)
        await expect.poll(() => foliateContentText(page)).toContain(book.passage)
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

  test('WXT keeps Wikisource long-book chapter boundaries, deep TOC jumps and restored position', async () => {
    const { context, page, pageErrors } = await launchExtension(wxtExtension)
    try {
      await openBook(page, 'moby-dick-wikisource.epub')
      await expect(page.locator('#header-title')).toContainText('Moby-Dick')
      await page.locator('#sidebar-button').evaluate((button: HTMLElement) => button.click())
      await expect(page.locator('#toc button')).toHaveCount(139)

      await page.locator('#settings-button').evaluate((button: HTMLElement) => button.click())
      await page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
      await page.locator('#close-settings').evaluate((button: HTMLElement) => button.click())
      await expect(page.locator('.continuous-ebook')).toBeVisible()

      await page.locator('#toc button').filter({ hasText: /^Loomings$/ })
        .evaluate((button: HTMLElement) => button.click())
      await expect.poll(() => continuousChapterText(page, 2)).toContain('Call me Ishmael')
      await page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
        const first = container.querySelectorAll<HTMLElement>('.continuous-section')[2]
        if (!first) throw new Error('First chapter is missing')
        container.scrollTop = first.offsetTop + first.offsetHeight - container.clientHeight * 0.8
        container.dispatchEvent(new Event('scroll'))
      })
      await expect.poll(() => continuousChapterText(page, 3)).toContain('I stuffed a shirt or two')
      await expect.poll(() => adjacentContinuousSectionsVisible(page)).toBe(true)
      await expect.poll(() => centerContinuousSectionIndex(page)).toBe(2)
      const beforeWheel = await page.locator('.continuous-ebook').evaluate((element: HTMLElement) => element.scrollTop)
      await page.locator('.continuous-ebook').hover()
      await page.mouse.wheel(0, 350)
      await expect.poll(() => page.locator('.continuous-ebook').evaluate((element: HTMLElement) => element.scrollTop))
        .toBeGreaterThan(beforeWheel)
      await expect.poll(() => centerContinuousSectionIndex(page)).toBe(3)
      await expect.poll(() => visibleContinuousText(page)).toContain('I stuffed a shirt or two')

      await page.locator('#toc button').filter({ hasText: /^The Chase\. Third Day$/ })
        .evaluate((button: HTMLElement) => button.click())
      await expect.poll(() => centerContinuousSectionIndex(page)).toBe(136)
      await expect.poll(() => continuousChapterText(page, 136)).toContain('The morning of the third day dawned fair and fresh')
      await expect.poll(() => progress(page)).toBeGreaterThan(0.9)
      const savedProgress = await progress(page)

      await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
      await expect(page.locator('#welcome-view')).toBeVisible()
      await page.reload()
      await page.locator('.library-card').filter({ hasText: /Moby-Dick/i }).first()
        .evaluate((card: HTMLElement) => card.click())
      await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
      await expect.poll(() => centerContinuousSectionIndex(page)).toBe(136)
      await expect.poll(() => continuousChapterText(page, 136)).toContain('The morning of the third day dawned fair and fresh')
      await expect.poll(() => progress(page)).toBeCloseTo(savedProgress, 2)
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

async function continuousChapterText(page: Page, sectionIndex: number) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement, index) =>
    [...container.querySelectorAll<HTMLElement>('.continuous-section')]
      .find(section => Number(section.dataset.sectionIndex) === index)
      ?.querySelector('iframe')?.contentDocument?.body?.innerText ?? '', sectionIndex)
}

async function centerContinuousSectionIndex(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
    const viewport = container.getBoundingClientRect()
    const middle = viewport.top + viewport.height / 2
    const section = [...container.querySelectorAll<HTMLElement>('.continuous-section')]
      .find(item => item.getBoundingClientRect().top <= middle && item.getBoundingClientRect().bottom > middle)
    return Number(section?.dataset.sectionIndex ?? -1)
  })
}

async function adjacentContinuousSectionsVisible(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
    const viewport = container.getBoundingClientRect()
    return [...container.querySelectorAll<HTMLElement>('.continuous-section')].slice(2, 4)
      .every(section => {
        const rect = section.getBoundingClientRect()
        return rect.top < viewport.bottom && rect.bottom > viewport.top
      })
  })
}

async function visibleContinuousText(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
    const viewport = container.getBoundingClientRect()
    return [...container.querySelectorAll<HTMLElement>('.continuous-section')]
      .filter(section => {
        const rect = section.getBoundingClientRect()
        return rect.top < viewport.bottom && rect.bottom > viewport.top
      })
      .map(section => section.querySelector('iframe')?.contentDocument?.body?.innerText ?? '')
      .join('\n')
  })
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
      .replace(/\u00ad/g, '')
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
