import { test, expect, chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/large-file.epub')
const minimumFixtureBytes = 20 * 1024 * 1024
const maximumLoadMilliseconds = 45_000
const maximumHeapBytes = 256 * 1024 * 1024

test('a very large EPUB stays within the loading and memory baseline', async ({}, testInfo) => {
  const fixtureBytes = statSync(bookPath).size
  expect(fixtureBytes).toBeGreaterThanOrEqual(minimumFixtureBytes)
  const { context, page } = await launchExtension()
  try {
    const session = await context.newCDPSession(page)
    await session.send('Performance.enable')
    const initialHeap = await usedHeap(session)
    const startedAt = Date.now()

    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: maximumLoadMilliseconds })
    const loadMilliseconds = Date.now() - startedAt
    await expect(page.locator('#sidebar-title')).toContainText('Very Large Reading Stress')
    await page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('.continuous-section')).toHaveCount(32)
    await scrollToSection(page, 24, 'LARGE-FILE-SECTION-025')
    await expect.poll(() => hasFrame(page, 0)).toBe(false)
    const activeFrameCount = await page.locator('.continuous-section iframe').count()

    const loadedHeap = await usedHeap(session)
    await testInfo.attach('performance-baseline.json', {
      body: JSON.stringify({
        fixtureBytes,
        loadMilliseconds,
        initialHeap,
        loadedHeap,
        reachedSection: 25,
        activeFrameCount,
      }, null, 2),
      contentType: 'application/json',
    })
    expect(loadMilliseconds).toBeLessThan(maximumLoadMilliseconds)
    expect(activeFrameCount).toBeGreaterThan(0)
    expect(activeFrameCount).toBeLessThanOrEqual(7)
    expect(loadedHeap).toBeLessThan(maximumHeapBytes)
    expect(loadedHeap - initialHeap).toBeLessThan(maximumHeapBytes)
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
      '--enable-precise-memory-info',
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

async function usedHeap(session: CDPSession) {
  const { metrics } = await session.send('Performance.getMetrics')
  const value = metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value
  expect(value).toBeDefined()
  return value ?? Number.POSITIVE_INFINITY
}

async function scrollToSection(page: Page, index: number, marker: string) {
  const section = page.locator('.continuous-section').nth(index)
  await section.evaluate((element: HTMLElement) => element.scrollIntoView({ block: 'center' }))
  await expect.poll(() => section.locator('iframe').evaluate((frame: HTMLIFrameElement, expectedMarker) =>
    frame.contentDocument?.body?.innerText.includes(expectedMarker) ?? false, marker).catch(() => false)).toBe(true)
}

async function hasFrame(page: Page, index: number) {
  return page.locator('.continuous-section').nth(index).locator('iframe').count().then(count => count > 0)
}
