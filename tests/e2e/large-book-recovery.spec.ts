import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/water-margin.epub')

test('a real Chinese EPUB opens within the long-book baseline after a damaged file error', async () => {
  const { context, page } = await launchExtension()
  try {
    await page.locator('#file-input').setInputFiles({
      name: 'damaged.epub',
      mimeType: 'application/epub+zip',
      buffer: Buffer.from('not an EPUB archive'),
    })
    await expect(page.locator('#loading-view')).toHaveAttribute('data-state', 'error')
    await page.locator('#loading-library-button').click()
    await expect(page.locator('#welcome-view')).toBeVisible()

    const startedAt = Date.now()
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    expect(Date.now() - startedAt).toBeLessThan(30_000)
    await expect(page.locator('#sidebar-title')).toContainText('水滸傳')
    await page.locator('#next-button').evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => progress(page)).toBeGreaterThan(0)
  } finally {
    await context.close()
  }
})

async function launchExtension(): Promise<{ context: BrowserContext, page: Page }> {
  const context = await chromium.launchPersistentContext('', {
    executablePath: existsSync(edgePath) ? edgePath : undefined,
    channel: existsSync(edgePath) ? undefined : 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  let [worker] = context.serviceWorkers()
  worker ||= await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`)
  await expect(page.locator('#welcome-view')).toBeVisible()
  return { context, page }
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}
