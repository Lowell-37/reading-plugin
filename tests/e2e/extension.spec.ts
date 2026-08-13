import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const booksPath = resolve('tests/fixtures/books')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

for (const format of ['epub', 'mobi', 'azw3'] as const) {
  test(`${format.toUpperCase()} opens a real book with TOC, navigation and progress restore`, async () => {
    const { context, page } = await launchExtension()
    try {
      await openBook(page, `alice.${format}`)
      await expect(page.locator('#sidebar-title')).toContainText(/Alice/i)
      await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(2)
      await expect(page.locator('[data-ai-scope="chapter"][data-ai-action="summary"]').first()).toBeHidden()

      await clickDom(page, '#toc button', 2)
      await expect.poll(() => progress(page)).toBeGreaterThan(0)
      const advanced = await progress(page)

      await clickDom(page, '#home-button')
      await expect(page.locator('#welcome-view')).toBeVisible()
      await page.waitForTimeout(500)
      await page.locator('.library-card').filter({ hasText: new RegExp(format, 'i') }).first()
        .evaluate((card: HTMLElement) => card.click())
      await expect(page.locator('body')).toHaveClass(/is-reading/)
      await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
      await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(advanced * 0.8)
    } finally {
      await context.close()
    }
  })
}

test('PDF renders text, zooms, jumps pages and restores progress', async () => {
  const { context, page } = await launchExtension()
  try {
    await openBook(page, 'tracemonkey.pdf')
    await expect(page.locator('#ebook-host')).toBeHidden()
    const pdfLayout = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('#reader-stage')!
      const viewport = document.querySelector<HTMLElement>('#pdf-viewport')!
      const firstPage = document.querySelector<HTMLElement>('.pdf-page[data-page="1"]')!
      const stageRect = stage.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      const pageRect = firstPage.getBoundingClientRect()
      return {
        ebookDisplay: getComputedStyle(document.querySelector<HTMLElement>('#ebook-host')!).display,
        viewportStartsInsideStage: viewportRect.top < stageRect.bottom && viewportRect.bottom > stageRect.top,
        pageIntersectsReader: pageRect.top < Math.min(stageRect.bottom, viewportRect.bottom)
          && pageRect.bottom > Math.max(stageRect.top, viewportRect.top),
      }
    })
    expect(pdfLayout).toEqual({
      ebookDisplay: 'none',
      viewportStartsInsideStage: true,
      pageIntersectsReader: true,
    })
    await expect(page.locator('#pdf-page-total')).not.toHaveText('/ 1')
    await expect.poll(async () => page.locator('.textLayer span').count()).toBeGreaterThan(0)
    await clickDom(page, '#pdf-zoom-in')
    await expect(page.locator('#pdf-zoom-label')).toHaveText('110%')
    await page.locator('#pdf-page-input').evaluate((input: HTMLInputElement) => {
      input.value = '3'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.locator('#pdf-page-input')).toHaveValue('3')
    await page.waitForTimeout(500)
    const advanced = await progress(page)
    expect(advanced).toBeGreaterThan(0)
    await clickDom(page, '#home-button')
    await expect(page.locator('#welcome-view')).toBeVisible()
    await page.waitForTimeout(500)
    await page.locator('.library-card').filter({ hasText: /pdf/i }).first()
      .evaluate((card: HTMLElement) => card.click())
    await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(advanced * 0.8)
  } finally {
    await context.close()
  }
})

async function launchExtension(): Promise<{ context: BrowserContext, page: Page }> {
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

async function openBook(page: Page, name: string) {
  await page.locator('#file-input').setInputFiles(resolve(booksPath, name))
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}

async function clickDom(page: Page, selector: string, index = 0) {
  await page.locator(selector).nth(index).evaluate((element: HTMLElement) => element.click())
}
