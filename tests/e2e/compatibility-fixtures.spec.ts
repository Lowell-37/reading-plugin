import { test, expect, chromium, type BrowserContext, type Frame, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const booksPath = resolve('tests/fixtures/books')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

test('real Chinese EPUB opens, advances past its cover and restores reading progress', async () => {
  const { context, page } = await launchExtension()
  try {
    await openBook(page, 'water-margin.epub')
    await expect(page.locator('#sidebar-title')).toContainText('水滸傳')
    await page.locator('#next-button').evaluate((button: HTMLElement) => button.click())
    await page.locator('#next-button').evaluate((button: HTMLElement) => button.click())
    await expect.poll(async () => findChapterText(page.frames())).not.toEqual('')
    await expect.poll(() => progress(page)).toBeGreaterThan(0)
    await assertReopenRestoresProgress(page, /水滸傳/i)
  } finally {
    await context.close()
  }
})

test('complex EPUB survives a broken TOC entry and navigates valid chapters', async () => {
  const { context, page } = await launchExtension()
  try {
    await openBook(page, 'compatibility-layout.epub')
    await expect(page.locator('#sidebar-title')).toContainText('Compatibility Vertical Text')
    await expect.poll(async () => findChapterText(page.frames())).toContain('COMPATIBILITY-VERTICAL-TEXT')
    await expect(page.locator('#toc button')).toHaveCount(4)

    await page.locator('#toc button').nth(1).evaluate((button: HTMLElement) => button.click())
    await expect.poll(async () => findChapterText(page.frames())).toContain('COMPATIBILITY-VERTICAL-TEXT')

    await page.locator('#toc button').nth(2).evaluate((button: HTMLElement) => button.click())
    await expect.poll(async () => findChapterText(page.frames())).toContain('FOOTNOTE-MARKER')
    await expect.poll(() => progress(page)).toBeGreaterThan(0)
    await assertReopenRestoresProgress(page, /Compatibility Vertical Text/i)
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

async function assertReopenRestoresProgress(page: Page, cardText: RegExp) {
  const advanced = await progress(page)
  await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
  await expect(page.locator('#welcome-view')).toBeVisible()
  await page.locator('.library-card').filter({ hasText: cardText }).first()
    .evaluate((card: HTMLElement) => card.click())
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
  await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(advanced * 0.8)
}

async function findChapterText(frames: Frame[]) {
  for (const frame of frames.slice(1)) {
    const text = await frame.locator('body').innerText().catch(() => '')
    if (text) return text
  }
  return ''
}
