import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

test('root extension shows persistent errors and does not keep invalid books', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await expectInvalidFile(page, {
      name: 'broken.epub',
      mimeType: 'application/epub+zip',
      buffer: Buffer.from('this is not an EPUB archive'),
    }, /EPUB/)

    await expectInvalidFile(page, {
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\ntruncated'),
    }, /PDF/)

    await page.locator('#file-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('plain text'),
    })
    await expect(page.locator('#loading-view')).toHaveAttribute('data-state', 'error')
    await expect(page.locator('#loading-title')).toHaveText('不支持这个文件')
    await expect(page.locator('#loading-detail')).toContainText('PDF、EPUB、MOBI 或 AZW3')
    await expect(page.locator('#loading-actions')).toBeVisible()
  } finally {
    await context.close()
  }
})

async function expectInvalidFile(
  page: Page,
  file: { name: string, mimeType: string, buffer: Buffer },
  expectedMessage: RegExp,
) {
  await page.locator('#file-input').setInputFiles(file)
  await expect(page.locator('#loading-view')).toHaveAttribute('data-state', 'error', { timeout: 30_000 })
  await expect(page.locator('#loading-detail')).toContainText(expectedMessage)
  await expect(page.locator('#loading-actions')).toBeVisible()
  await page.waitForTimeout(3_500)
  await expect(page.locator('#loading-view')).toHaveAttribute('data-state', 'error')
  await page.locator('#loading-library-button').click()
  await expect(page.locator('#welcome-view')).toBeVisible()
  await expect(page.locator('.library-card')).toHaveCount(0)
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
