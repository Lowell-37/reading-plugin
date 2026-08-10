import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const bookPath = resolve('tests/fixtures/books/boundaries.epub')
const pdfPath = resolve('tests/fixtures/books/tracemonkey.pdf')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

test('reuses EPUB section text, cancels stale search UI and navigates from sentence context', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await instrumentSectionLoads(page)

    await submitSearch(page, 'SHORT-CHAPTER-START')
    await expect(page.locator('#search-results .search-result')).toHaveCount(1)
    await submitSearch(page, 'stable scrolling')
    await expect(page.locator('#search-status')).toHaveText(/找到 140 处结果/)

    const visibleResults = page.locator('#search-results .search-result')
    await expect(visibleResults).toHaveCount(140)
    await expect(visibleResults.first().locator('span')).toHaveText(
      'This paragraph makes the chapter tall enough to test stable scrolling inside one section.',
    )
    expect(await visibleResults.locator('span').allTextContents()).not.toContain('SHORT-CHAPTER-START')

    await visibleResults.first().evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => loadedChapterContains(page, 'LONG-PARAGRAPH-001')).toBe(true)

    const loadsAfterSecondQuery = await sectionLoadCounts(page)
    expect(loadsAfterSecondQuery).toHaveLength(14)
    expect(loadsAfterSecondQuery.every(count => count === 1)).toBe(true)

    await submitSearch(page, 'IMAGE-CHAPTER')
    await expect(page.locator('#search-status')).toHaveText('找到 1 处结果')
    expect(await sectionLoadCounts(page)).toEqual(loadsAfterSecondQuery)
  } finally {
    await context.close()
  }
})

test('cancels stale PDF search and navigates from complete sentence context', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await page.locator('#file-input').setInputFiles(pdfPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })

    await submitSearch(page, 'Dynamic languages')
    await submitSearch(page, 'TraceMonkey supports')
    await expect(page.locator('#search-status')).toHaveText(/找到 \d+ 处结果/)

    const results = page.locator('#search-results .search-result')
    await expect(results.first().locator('strong')).toHaveText('第 2 页')
    await expect(results.first().locator('span')).toHaveText(
      'TraceMonkey supports all the JavaScript features of Spi- derMonkey, with a 2x-20x speedup for traceable programs.',
    )
    expect(await results.locator('span').allTextContents()).not.toContain('Dynamic languages')

    const immediateNavigation = await results.first().evaluate((button: HTMLElement) => {
      const input = document.querySelector<HTMLInputElement>('#pdf-page-input')!
      const viewport = document.querySelector<HTMLElement>('#pdf-viewport')!
      const target = document.querySelector<HTMLElement>('.pdf-page[data-page="2"]')!
      const before = { input: input.value, scrollTop: viewport.scrollTop }
      button.click()
      return {
        before,
        after: { input: input.value, scrollTop: viewport.scrollTop },
        target: { offsetTop: target.offsetTop, state: target.dataset.state },
      }
    })
    expect(immediateNavigation.after.scrollTop).toBe(immediateNavigation.target.offsetTop)
    await expect(page.locator('#pdf-page-input')).toHaveValue('2')

    await submitSearch(page, 'the')
    await expect(page.locator('#search-status')).toHaveText('找到 985 处结果（显示前 300 条）')
    await expect(page.locator('#search-results .search-result')).toHaveCount(300)
  } finally {
    await context.close()
  }
})

async function instrumentSectionLoads(page: Page) {
  await page.locator('foliate-view').evaluate((view: any) => {
    const counts = Array.from({ length: view.book.sections.length }, () => 0)
    ;(window as any).__searchSectionLoads = counts
    view.book.sections.forEach((section: any, index: number) => {
      const createDocument = section.createDocument.bind(section)
      section.createDocument = async () => {
        counts[index] = (counts[index] ?? 0) + 1
        if (index === 1) await new Promise(resolve => setTimeout(resolve, 450))
        return createDocument()
      }
    })
  })
}

async function submitSearch(page: Page, query: string) {
  await page.locator('#search-input').fill(query)
  await page.locator('#search-form').evaluate((form: HTMLFormElement) => form.requestSubmit())
}

async function sectionLoadCounts(page: Page): Promise<number[]> {
  return page.evaluate(() => [...((window as any).__searchSectionLoads || [])])
}

async function loadedChapterContains(page: Page, marker: string) {
  for (const frame of page.frames()) {
    try {
      if ((await frame.locator('body').innerText()).includes(marker)) return true
    } catch {}
  }
  return false
}

async function launchRootExtension(): Promise<{ context: BrowserContext, page: Page }> {
  const context = await chromium.launchPersistentContext('', {
    executablePath: existsSync(edgePath) ? edgePath : undefined,
    channel: existsSync(edgePath) ? undefined : 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })
  let [worker] = context.serviceWorkers()
  worker ||= await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`)
  await expect(page.locator('#welcome-view')).toBeVisible()
  return { context, page }
}
