import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const bookPath = resolve('tests/fixtures/books/alice.epub')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

test('root extension backs up and restores a real EPUB with reading progress', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('body')).toHaveClass(/is-reading/)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(2)
    await page.locator('#toc button').nth(2).evaluate((element: HTMLElement) => element.click())
    await expect.poll(() => progress(page)).toBeGreaterThan(0)
    const savedProgress = await progress(page)

    await page.locator('#home-button').evaluate((element: HTMLElement) => element.click())
    await expect(page.locator('.library-card')).toHaveCount(1)
    const downloadPromise = page.waitForEvent('download')
    await page.locator('#backup-library').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.quietreader$/)
    const backupPath = await download.path()
    expect(backupPath).toBeTruthy()
    await expect(page.locator('#backup-status')).toHaveAttribute('data-state', 'exported')

    await page.locator('.delete-book').evaluate((element: HTMLElement) => element.click())
    await expect(page.locator('.library-card')).toHaveCount(0)
    await page.locator('#backup-file-input').setInputFiles(backupPath!)
    await expect(page.locator('#backup-status')).toHaveAttribute('data-state', 'restored')
    await expect(page.locator('.library-card')).toHaveCount(1)

    await page.locator('.library-card').evaluate((element: HTMLElement) => element.click())
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(savedProgress * 0.8)
  } finally {
    await context.close()
  }
})

async function launchRootExtension(): Promise<{ context: BrowserContext, page: Page }> {
  const context = await chromium.launchPersistentContext('', {
    executablePath: existsSync(edgePath) ? edgePath : undefined,
    channel: existsSync(edgePath) ? undefined : 'chromium',
    headless: true,
    acceptDownloads: true,
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

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}
