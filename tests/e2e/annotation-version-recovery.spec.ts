import { test, expect, chromium, type BrowserContext, type Download, type Frame, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const firstEdition = resolve('tests/fixtures/books/versioned-v1.epub')
const secondEdition = resolve('tests/fixtures/books/versioned-v2.epub')
const visibleName = 'versioned.epub'

test('import recovers one changed EPUB quote and marks an ambiguous quote unresolved', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await uploadEdition(page, firstEdition)
    await page.locator('#toc button').nth(1).evaluate((button: HTMLElement) => button.click())
    const firstFrame = await compassFrame(page)
    await addHighlight(page, firstFrame, 'The silver compass pointed north at dawn')
    await addHighlight(page, firstFrame, 'A brass lantern glowed softly beside the door')

    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    const downloadPromise = page.waitForEvent('download')
    await page.locator('#export-annotations-json').click()
    const archivePath = await downloadPath(await downloadPromise)

    await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#welcome-view')).toBeVisible()
    await uploadEdition(page, secondEdition)
    await page.locator('#toc button').nth(1).evaluate((button: HTMLElement) => button.click())
    await compassFrame(page)
    await trackRecoverySectionLoads(page)
    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    await page.locator('#annotation-import-input').setInputFiles(archivePath)

    await expect(page.locator('.annotation-item')).toHaveCount(2)
    expect(await recoverySectionLoadCount(page)).toBeLessThanOrEqual(3)
    await expect(page.locator('.annotation-anchor-status')).toHaveCount(1)
    await expect(page.locator('.annotation-anchor-status')).toHaveText('需要重新定位')
    await expect.poll(() => storedAnchorStatuses(page)).toEqual(['resolved', 'unresolved'])
    await expectRecoveredOverlay(page, 'The old silver compass pointed north at dawn')
  } finally {
    await context.close()
  }
})

async function trackRecoverySectionLoads(page: Page) {
  await page.evaluate(() => {
    const view: any = document.querySelector('foliate-view')
    ;(window as any).__recoverySectionLoads = 0
    for (const section of view.book.sections) {
      const createDocument = section.createDocument.bind(section)
      section.createDocument = async () => {
        ;(window as any).__recoverySectionLoads += 1
        return createDocument()
      }
    }
  })
}

async function recoverySectionLoadCount(page: Page) {
  return page.evaluate(() => (window as any).__recoverySectionLoads || 0)
}

async function uploadEdition(page: Page, path: string) {
  await page.locator('#file-input').setInputFiles({
    name: visibleName,
    mimeType: 'application/epub+zip',
    buffer: await readFile(path),
  })
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
}

async function addHighlight(page: Page, frame: Frame, phrase: string) {
  await frame.evaluate(text => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !(node.textContent || '').includes(text)) node = walker.nextNode()
    if (!node) throw new Error(`Missing selectable phrase: ${text}`)
    const start = (node.textContent || '').indexOf(text)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + text.length)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, phrase)
  await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
  await page.locator('#highlight-selection').click()
  await page.locator('#close-tools').click()
}

async function expectRecoveredOverlay(page: Page, phrase: string) {
  await expect.poll(() => page.evaluate(text => {
    const view: any = document.querySelector('foliate-view')
    const content = view?.renderer?.getContents?.().find((item: any) => item.doc?.body?.textContent?.includes(text))
    if (!content?.overlayer) return { groups: 0, hit: false }
    const walker = content.doc.createTreeWalker(content.doc.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !(node.textContent || '').includes(text)) node = walker.nextNode()
    if (!node) return { groups: 0, hit: false }
    const start = (node.textContent || '').indexOf(text)
    const range = content.doc.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + text.length)
    const target = range.getBoundingClientRect()
    const groups = [...content.overlayer.element.querySelectorAll(':scope > g')]
    const hit = groups.some((group: Element) => [...group.querySelectorAll('rect')].some(rect => {
      const left = Number(rect.getAttribute('x'))
      const top = Number(rect.getAttribute('y'))
      const right = left + Number(rect.getAttribute('width'))
      const bottom = top + Number(rect.getAttribute('height'))
      return Math.min(target.right, right) > Math.max(target.left, left)
        && Math.min(target.bottom, bottom) > Math.max(target.top, top)
    }))
    return { groups: groups.length, hit }
  }, phrase)).toEqual({ groups: 1, hit: true })
}

async function storedAnchorStatuses(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('quiet-reader')
      request.onsuccess = () => resolvePromise(request.result)
      request.onerror = () => reject(request.error)
    })
    const records = await new Promise<any[]>((resolvePromise, reject) => {
      const request = database.transaction('books').objectStore('books').getAll()
      request.onsuccess = () => resolvePromise(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    const current = records
      .filter(record => record.name === 'versioned.epub')
      .sort((left, right) => right.openedAt - left.openedAt)[0]
    return (current?.annotations || []).map((item: any) => item.anchorStatus).sort()
  })
}

async function compassFrame(page: Page): Promise<Frame> {
  let match: Frame | undefined
  await expect.poll(async () => {
    for (const candidate of page.frames().filter(frame => frame !== page.mainFrame())) {
      const text = await candidate.locator('body').innerText().catch(() => '')
      if (/Compass Room/.test(text)) {
        match = candidate
        return true
      }
    }
    return false
  }).toBe(true)
  if (!match) throw new Error('No Compass Room frame')
  return match
}

async function downloadPath(download: Download) {
  const path = await download.path()
  if (!path) throw new Error('Annotation archive download path unavailable')
  return path
}

async function launchRootExtension(): Promise<{ context: BrowserContext, page: Page }> {
  const context = await chromium.launchPersistentContext('', {
    executablePath: existsSync(edgePath) ? edgePath : undefined,
    channel: existsSync(edgePath) ? undefined : 'chromium',
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  let [worker] = context.serviceWorkers()
  worker ||= await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`)
  await expect(page.locator('#welcome-view')).toBeVisible()
  return { context, page }
}
