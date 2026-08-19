import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import AdmZip from 'adm-zip'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/peter-rabbit.epub')

test('a fixed public-domain illustrated EPUB renders its images and navigates to the ending', async () => {
  const archive = new AdmZip(readFileSync(bookPath))
  const entries = archive.getEntries()
  const images = entries.filter(entry => /\.(png|jpe?g|gif|svg)$/i.test(entry.entryName))
  const unpackedBytes = entries.reduce((total, entry) => total + entry.header.size, 0)
  expect(images).toHaveLength(29)
  expect(images.reduce((total, entry) => total + entry.header.size, 0) / unpackedBytes).toBeGreaterThan(0.9)
  const packageDocument = entries.find(entry => entry.entryName.endsWith('.opf'))?.getData().toString() ?? ''
  expect(packageDocument).toContain('<dc:rights>Public Domain in the USA.</dc:rights>')

  const { context, page } = await launchExtension()
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('#sidebar-title')).toContainText('The Tale of Peter Rabbit')
    await expect(page.locator('#toc button')).toHaveCount(7)
    await page.locator('#toc button').first().evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => visibleBookText(page)).toContain('THE TALE OF')
    await expect.poll(() => loadedIllustrationCount(page)).toBeGreaterThanOrEqual(28)
    const startProgress = await progress(page)

    await page.locator('#toc button').last().evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => visibleBookText(page)).toContain('THE END')
    await expect.poll(() => progress(page)).toBeGreaterThan(startProgress + 0.2)
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

async function loadedIllustrationCount(page: Page) {
  return page.evaluate(() => {
    const view: any = document.querySelector('foliate-view')
    const images = view?.renderer?.getContents?.().flatMap((item: any) =>
      [...(item.doc?.images ?? [])]) ?? []
    return images.filter((image: HTMLImageElement) => image.complete && image.naturalWidth > 0).length
  })
}

async function visibleBookText(page: Page) {
  return page.evaluate(() => {
    const view: any = document.querySelector('foliate-view')
    return view?.renderer?.getContents?.().map((item: any) => item.doc?.body?.innerText ?? '').join('\n') ?? ''
  })
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}
