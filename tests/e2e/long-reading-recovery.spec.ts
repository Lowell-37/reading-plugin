import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/large-reading.epub')

test('long continuous reading keeps a bounded chapter window and survives a browser restart', async () => {
  const profileDir = await mkdtemp(join(tmpdir(), 'quiet-reader-long-reading-'))
  let firstContext: BrowserContext | null = null
  let secondContext: BrowserContext | null = null
  try {
    const first = await launchRootExtension(profileDir)
    firstContext = first.context
    await first.page.locator('#file-input').setInputFiles(bookPath)
    await expect(first.page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await first.page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
    await expect(first.page.locator('.continuous-section')).toHaveCount(48)

    await scrollToSection(first.page, 36, 'STRESS-SECTION-037')
    await expect.poll(() => loadedFrameCount(first.page)).toBeLessThanOrEqual(7)
    await expect.poll(async () => hasFrame(first.page, 0)).toBe(false)
    const savedProgress = await progress(first.page)
    expect(savedProgress).toBeGreaterThan(0.6)

    await first.context.close()
    firstContext = null

    const second = await launchRootExtension(profileDir)
    secondContext = second.context
    await expect(second.page.locator('.library-card')).toContainText('Large Reading Stress')
    await second.page.locator('.library-card').filter({ hasText: 'Large Reading Stress' }).click()
    await expect(second.page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect.poll(() => progress(second.page)).toBeGreaterThanOrEqual(savedProgress * 0.8)
  } finally {
    await secondContext?.close()
    await firstContext?.close()
    await rm(profileDir, { recursive: true, force: true })
  }
})

async function launchRootExtension(userDataDir: string): Promise<{ context: BrowserContext, page: Page }> {
  const context = await chromium.launchPersistentContext(userDataDir, {
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
  await page.locator('.continuous-ebook').hover()
  for (let step = 0; step < 300; step += 1) {
    if (await hasFrame(page, index) && (await visibleText(page)).includes(marker)) return
    await page.mouse.wheel(0, 720)
    await page.waitForTimeout(30)
  }
  expect(await visibleText(page)).toContain(marker)
}

async function hasFrame(page: Page, index: number) {
  return page.locator('.continuous-section').nth(index).locator('iframe').count().then(count => count > 0)
}

async function loadedFrameCount(page: Page) {
  return page.locator('.continuous-section iframe').count()
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}

async function visibleText(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
    const viewport = container.getBoundingClientRect()
    return [...container.querySelectorAll<HTMLElement>('.continuous-section')]
      .filter(section => {
        const rect = section.getBoundingClientRect()
        return rect.bottom > viewport.top && rect.top < viewport.bottom
      })
      .map(section => section.querySelector('iframe')?.contentDocument?.body?.innerText || '')
      .join('\n')
  })
}
