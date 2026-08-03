import { test, expect, chromium, type BrowserContext, type Frame, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const epubPath = resolve('tests/fixtures/books/alice.epub')

test('EPUB highlight survives typography, flow changes, stale CFI and reopen', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await page.locator('#file-input').setInputFiles(epubPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await page.locator('#toc button').nth(3).evaluate((button: HTMLElement) => button.click())
    const frame = await chapterFrame(page)
    const selectedText = await selectDistinctiveText(frame)

    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    await page.locator('#highlight-selection').click()
    await expect(page.locator('.annotation-item q')).toContainText(selectedText)

    const stored = await firstStoredAnnotation(page)
    expect(stored.anchor).toMatchObject({
      version: 1,
      kind: 'ebook',
      section: expect.any(Number),
      textOffset: expect.any(Number),
    })
    expect(stored.anchor.quote.exact).toBe(selectedText)

    await page.locator('#close-tools').click()
    await page.locator('#settings-button').evaluate((button: HTMLElement) => button.click())
    await setRange(page, '#font-size', '28')
    await setRange(page, '#line-height', '2.05')
    await setRange(page, '#page-width', '620')
    await page.locator('[data-flow="scrolled"]').click()
    await expect(page.locator('.continuous-ebook')).toBeVisible()
    await expect.poll(() => visibleContinuousHighlightCount(page)).toBeGreaterThan(0)

    await corruptStoredEbookCfi(page)
    await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#welcome-view')).toBeVisible()
    await page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect(page.locator('.continuous-ebook')).toBeVisible()
    await expect.poll(() => visibleContinuousHighlightCount(page)).toBeGreaterThan(0)

    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('.annotation-item q')).toContainText(selectedText)
    const repaired = await firstStoredAnnotation(page)
    expect(repaired.locator).not.toContain('/999')
    expect(repaired.anchor.cfi).toBe(repaired.locator)
    expect(repaired.anchor.quote.exact).toBe(selectedText)
  } finally {
    await context.close()
  }
})

async function setRange(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((element: HTMLInputElement, nextValue) => {
    element.value = nextValue
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function selectDistinctiveText(frame: Frame) {
  return frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !/Alice/.test(node.textContent || '')) node = walker.nextNode()
    if (!node || (node.textContent || '').trim().length < 24) {
      const fallback = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      node = fallback.nextNode()
      while (node && (node.textContent || '').trim().length < 24) node = fallback.nextNode()
    }
    if (!node) throw new Error('No distinctive EPUB text found')
    const start = Math.max(0, (node.textContent || '').search(/\S/))
    const end = Math.min((node.textContent || '').length, start + 32)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return selection?.toString().trim() || ''
  })
}

async function firstStoredAnnotation(page: Page): Promise<any> {
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
    return records[0]?.annotations?.[0] || null
  })
}

async function corruptStoredEbookCfi(page: Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('quiet-reader')
      request.onsuccess = () => resolvePromise(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolvePromise, reject) => {
      const transaction = database.transaction('books', 'readwrite')
      const store = transaction.objectStore('books')
      const request = store.getAll()
      request.onsuccess = () => {
        const record = request.result[0]
        record.annotations[0].locator = 'epubcfi(/999)'
        record.annotations[0].anchor.cfi = 'epubcfi(/999)'
        store.put(record)
      }
      transaction.oncomplete = () => resolvePromise()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  })
}

async function visibleContinuousHighlightCount(page: Page) {
  return page.locator('.continuous-section svg g rect').count()
}

async function chapterFrame(page: Page): Promise<Frame> {
  let match: Frame | undefined
  await expect.poll(async () => {
    for (const candidate of page.frames().filter(frame => frame !== page.mainFrame())) {
      const text = await candidate.locator('body').innerText().catch(() => '')
      if (text.length > 200 && /Alice/i.test(text)) {
        match = candidate
        return true
      }
    }
    return false
  }).toBe(true)
  if (!match) throw new Error('No readable EPUB chapter frame')
  return match
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
