import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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

test('a fresh Edge profile can restore a backed-up EPUB and reading progress', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quiet-reader-fresh-profile-'))
  const backupPath = join(directory, 'library.quietreader')
  let context: BrowserContext | null = null
  try {
    const original = await launchRootExtension(join(directory, 'original-profile'))
    context = original.context
    const extensionId = new URL(original.page.url()).host
    await original.page.locator('#file-input').setInputFiles(bookPath)
    await expect(original.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await original.page.locator('#toc button').nth(2).evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => progress(original.page)).toBeGreaterThan(0)
    const savedProgress = await progress(original.page)
    await original.page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    const downloadPromise = original.page.waitForEvent('download')
    await original.page.locator('#backup-library').click()
    await (await downloadPromise).saveAs(backupPath)
    await context.close()
    context = null

    const fresh = await launchRootExtension(join(directory, 'fresh-profile'))
    context = fresh.context
    expect(new URL(fresh.page.url()).host).toBe(extensionId)
    await expect(fresh.page.locator('.library-card')).toHaveCount(0)
    await fresh.page.locator('#backup-file-input').setInputFiles(backupPath)
    await expect(fresh.page.locator('#backup-status')).toHaveAttribute('data-state', 'restored')
    await expect(fresh.page.locator('.library-card')).toContainText('Alice')
    await fresh.page.locator('.library-card').evaluate((card: HTMLElement) => card.click())
    await expect(fresh.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => progress(fresh.page)).toBeGreaterThanOrEqual(savedProgress * 0.8)
  } finally {
    await context?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

async function launchRootExtension(profilePath = ''): Promise<{ context: BrowserContext, page: Page }> {
  const context = await chromium.launchPersistentContext(profilePath, {
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
