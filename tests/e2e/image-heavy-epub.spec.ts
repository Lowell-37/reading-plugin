import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import AdmZip from 'adm-zip'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/image-heavy.epub')
const minimumFixtureBytes = 18 * 1024 * 1024

test('an image-heavy EPUB preserves mixed compression, images and deep navigation', async () => {
  expect(statSync(bookPath).size).toBeGreaterThanOrEqual(minimumFixtureBytes)
  const archiveBytes = readFileSync(bookPath)
  expect(firstLocalEntry(archiveBytes)).toEqual({ name: 'mimetype', method: 0, extraLength: 0 })
  const archiveHash = sha256(archiveBytes)
  expect(rebuildHash('UTC')).toBe(archiveHash)
  expect(rebuildHash('Asia/Shanghai')).toBe(archiveHash)
  const archive = new AdmZip(bookPath)
  const pngEntries = archive.getEntries().filter(entry => entry.entryName.endsWith('.png'))
  const svgEntries = archive.getEntries().filter(entry => entry.entryName.endsWith('.svg'))
  expect(pngEntries).toHaveLength(8)
  expect(svgEntries).toHaveLength(1)
  expect(pngEntries.every(entry => compressionRatio(entry) > 0.9)).toBe(true)
  expect(compressionRatio(svgEntries[0]!)).toBeLessThan(0.3)

  const { context, page } = await launchExtension()
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('#sidebar-title')).toContainText('Image Heavy Compression Stress')
    await expect(page.locator('#toc button')).toHaveCount(8)
    await page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('.continuous-section')).toHaveCount(8)
    await expectChapterImages(page, 0, 'IMAGE-HEAVY-SECTION-001')
    await scrollToSection(page, 6, 'IMAGE-HEAVY-SECTION-007')
    await expectChapterImages(page, 6, 'IMAGE-HEAVY-SECTION-007')
    await expect.poll(() => hasFrame(page, 0)).toBe(false)
    await expect.poll(() => page.locator('.continuous-section iframe').count()).toBeLessThanOrEqual(7)
    await expect.poll(() => progress(page)).toBeGreaterThan(0.65)
  } finally {
    await context.close()
  }
})

function compressionRatio(entry: AdmZip.IZipEntry) {
  return entry.header.compressedSize / entry.header.size
}

function firstLocalEntry(archiveBytes: Buffer) {
  expect(archiveBytes.readUInt32LE(0)).toBe(0x04034b50)
  const nameLength = archiveBytes.readUInt16LE(26)
  return {
    name: archiveBytes.subarray(30, 30 + nameLength).toString(),
    method: archiveBytes.readUInt16LE(8),
    extraLength: archiveBytes.readUInt16LE(28),
  }
}

function rebuildHash(timezone: string) {
  execFileSync(process.execPath, ['scripts/create-image-heavy-epub.mjs'], {
    env: { ...process.env, TZ: timezone },
  })
  return sha256(readFileSync(bookPath))
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

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

async function scrollToSection(page: Page, index: number, marker: string) {
  const section = page.locator('.continuous-section').nth(index)
  await section.evaluate((element: HTMLElement) => element.scrollIntoView({ block: 'center' }))
  await expect.poll(() => section.locator('iframe').evaluate((frame: HTMLIFrameElement, expectedMarker) =>
    frame.contentDocument?.body?.innerText.includes(expectedMarker) ?? false, marker).catch(() => false)).toBe(true)
}

async function expectChapterImages(page: Page, index: number, marker: string) {
  const section = page.locator('.continuous-section').nth(index)
  const frame = section.locator('iframe')
  await expect.poll(() => frame.evaluate((element: HTMLIFrameElement, expectedMarker) => {
    const document = element.contentDocument
    const images = [...(document?.images ?? [])]
    return document?.body?.innerText.includes(expectedMarker)
      && images.length === 2
      && images.every(image => image.complete && image.naturalWidth > 0)
  }, marker).catch(() => false)).toBe(true)
}

async function hasFrame(page: Page, index: number) {
  return page.locator('.continuous-section').nth(index).locator('iframe').count().then(count => count > 0)
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}
