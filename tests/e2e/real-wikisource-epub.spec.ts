import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import AdmZip from 'adm-zip'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/moby-dick-wikisource.epub')

test('Wikisource long-form EPUB renders its 135-chapter TOC and restores a deep chapter', async () => {
  const archive = new AdmZip(readFileSync(bookPath))
  const chapters = archive.getEntries().filter(entry => /Chapter_\d+\.xhtml$/.test(entry.entryName))
  expect(chapters).toHaveLength(135)
  const packageDocument = archive.getEntry('OPS/content.opf')?.getData().toString() ?? ''
  expect(packageDocument).toContain('https://en.wikisource.org/wiki/Moby-Dick_')
  expect(packageDocument).toContain('Creative Commons BY-SA 3.0')
  expect(packageDocument).toContain('GNU Free Documentation License')

  const { context, page } = await launchExtension()
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('#sidebar-title')).toContainText('Moby-Dick')
    await expect(page.locator('#toc button')).toHaveCount(139)

    await page.locator('#toc button').filter({ hasText: /^Loomings$/ })
      .evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => visibleBookText(page)).toContain('Call me Ishmael')

    await page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('.continuous-ebook')).toBeVisible()
    expect(await page.locator('.continuous-section').count()).toBeGreaterThan(130)
    await page.locator('#toc button').filter({ hasText: /^Loomings$/ })
      .evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => adjacentChapterText(page)).toContain('Call me Ishmael')
    await page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
      const firstChapter = container.querySelectorAll<HTMLElement>('.continuous-section')[2]
      if (!firstChapter) throw new Error('First chapter is missing from continuous layout')
      container.scrollTop = firstChapter.offsetTop + firstChapter.offsetHeight - container.clientHeight * 0.8
      container.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => adjacentChapterText(page)).toContain('Call me Ishmael')
    await expect.poll(() => adjacentChapterText(page)).toContain('I stuffed a shirt or two')
    await expect.poll(() => adjacentChaptersVisible(page)).toBe(true)
    await expect.poll(() => centerChapterIndex(page)).toBe(2)
    const beforeWheel = await page.locator('.continuous-ebook').evaluate((element: HTMLElement) => element.scrollTop)
    await page.locator('.continuous-ebook').hover()
    await page.mouse.wheel(0, 350)
    await expect.poll(() => page.locator('.continuous-ebook').evaluate((element: HTMLElement) => element.scrollTop))
      .toBeGreaterThan(beforeWheel)
    await expect.poll(() => centerChapterIndex(page)).toBe(3)
    await expect.poll(() => viewportChapterText(page)).toContain('I stuffed a shirt or two')

    await page.locator('#toc button').filter({ hasText: /^The Chase\. Third Day$/ })
      .evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => centerChapterIndex(page)).toBe(136)
    await expect.poll(() => viewportChapterText(page)).toContain('The morning of the third day dawned fair and fresh')
    await expect(page.locator('#toc button.active')).toHaveText('The Chase. Third Day')
    await expect.poll(() => progress(page)).toBeGreaterThan(0.9)
    const savedProgress = await progress(page)

    await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#welcome-view')).toBeVisible()
    await page.locator('.library-card').filter({ hasText: /Moby-Dick/i }).first()
      .evaluate((card: HTMLElement) => card.click())
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect.poll(() => centerChapterIndex(page)).toBe(136)
    await expect.poll(() => viewportChapterText(page)).toContain('The morning of the third day dawned fair and fresh')
    await expect(page.locator('#toc button.active')).toHaveText('The Chase. Third Day')
    await expect.poll(() => progress(page)).toBeCloseTo(savedProgress, 2)
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

async function visibleBookText(page: Page) {
  return page.evaluate(() => {
    const view: any = document.querySelector('foliate-view')
    return view?.renderer?.getContents?.().map((item: any) => item.doc?.body?.innerText ?? '').join('\n') ?? ''
  })
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}

async function adjacentChapterText(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('.continuous-section')].slice(2, 4)
      .map(section => section.querySelector('iframe')?.contentDocument?.body?.innerText ?? '')
      .join('\n'))
}

async function adjacentChaptersVisible(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
    const viewport = container.getBoundingClientRect()
    return [...container.querySelectorAll<HTMLElement>('.continuous-section')].slice(2, 4)
      .every(section => {
        const rect = section.getBoundingClientRect()
        return rect.top < viewport.bottom && rect.bottom > viewport.top
      })
  })
}

async function centerChapterIndex(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
    const viewport = container.getBoundingClientRect()
    const middle = viewport.top + viewport.height / 2
    const section = [...container.querySelectorAll<HTMLElement>('.continuous-section')]
      .find(item => item.getBoundingClientRect().top <= middle && item.getBoundingClientRect().bottom > middle)
    return Number(section?.dataset.sectionIndex ?? -1)
  })
}

async function viewportChapterText(page: Page) {
  return page.locator('.continuous-ebook').evaluate((container: HTMLElement) => {
    const viewport = container.getBoundingClientRect()
    return [...container.querySelectorAll<HTMLElement>('.continuous-section')]
      .filter(section => {
        const rect = section.getBoundingClientRect()
        return rect.top < viewport.bottom && rect.bottom > viewport.top
      })
      .map(section => section.querySelector('iframe')?.contentDocument?.body?.innerText ?? '')
      .join('\n')
  })
}
