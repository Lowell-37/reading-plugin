import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/boundaries.epub')

test('continuous mode crosses short, blank, image and long chapter boundaries smoothly', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('.continuous-ebook')).toBeVisible()
    await expect(page.locator('.continuous-section')).toHaveCount(14)
    await expect.poll(() => loadedFrameCount(page)).toBeGreaterThan(1)

    const initialMarkers = await visibleChapterText(page)
    expect(initialMarkers).toContain('SHORT-CHAPTER-START')
    expect(initialMarkers).toContain('IMAGE-CHAPTER')

    const imageHeight = await sectionHeight(page, 2)
    expect(imageHeight).toBeGreaterThan(400)

    const blankBottom = await sectionBottom(page, 1)
    await page.locator('.continuous-ebook').hover()
    await page.mouse.wheel(0, 900)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(blankBottom - 20)

    await scrollToSection(page, 3, 120)
    const longMetrics = await sectionMetrics(page, 3)
    expect(longMetrics.height).toBeGreaterThan(longMetrics.viewportHeight * 3)
    const before = await scrollTop(page)
    await page.mouse.wheel(0, 620)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 300)
    const after = await scrollTop(page)
    expect(after).toBeLessThan(longMetrics.bottom)

    await page.locator('.continuous-ebook').evaluate((element: HTMLElement) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(async () => (await sectionState(page, 0)).hasFrame).toBe(false)
    const preservedFirstHeight = (await sectionState(page, 0)).height
    expect(preservedFirstHeight).toBeGreaterThanOrEqual(160)
    expect(await loadedFrameCount(page)).toBeLessThanOrEqual(7)

    await scrollToSection(page, 0)
    await expect.poll(() => visibleChapterText(page)).toContain('SHORT-CHAPTER-START')
    const reloadedFirst = await sectionState(page, 0)
    expect(reloadedFirst.hasFrame).toBe(true)
    expect(Math.abs(reloadedFirst.height - preservedFirstHeight)).toBeLessThan(30)
  } finally {
    await context.close()
  }
})

async function visibleChapterText(page: Page) {
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

async function loadedFrameCount(page: Page) {
  return page.locator('.continuous-section iframe').count()
}

async function scrollTop(page: Page) {
  return page.locator('.continuous-ebook').evaluate((element: HTMLElement) => element.scrollTop)
}

async function sectionHeight(page: Page, index: number) {
  return page.locator('.continuous-section').nth(index).evaluate((element: HTMLElement) => element.offsetHeight)
}

async function sectionBottom(page: Page, index: number) {
  return page.locator('.continuous-section').nth(index).evaluate((element: HTMLElement) => element.offsetTop + element.offsetHeight)
}

async function scrollToSection(page: Page, index: number, offset = 0) {
  await page.locator('.continuous-ebook').evaluate((container: HTMLElement, args) => {
    const section = container.querySelectorAll<HTMLElement>('.continuous-section')[args.index]
    if (!section) throw new Error(`Missing continuous section ${args.index}`)
    container.scrollTop = section.offsetTop + args.offset
    container.dispatchEvent(new Event('scroll'))
  }, { index, offset })
  await expect.poll(async () => (await sectionState(page, index)).hasFrame).toBe(true)
}

async function sectionMetrics(page: Page, index: number) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement, targetIndex) => {
    const section = container.querySelectorAll<HTMLElement>('.continuous-section')[targetIndex]
    if (!section) throw new Error(`Missing continuous section ${targetIndex}`)
    return {
      height: section.offsetHeight,
      bottom: section.offsetTop + section.offsetHeight,
      viewportHeight: container.clientHeight,
    }
  }, index)
}

async function sectionState(page: Page, index: number) {
  return page.locator('.continuous-section').nth(index).evaluate((element: HTMLElement) => ({
    hasFrame: Boolean(element.querySelector('iframe')),
    height: element.offsetHeight,
  }))
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
