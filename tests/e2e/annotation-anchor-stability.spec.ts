import { test, expect, chromium, type BrowserContext, type Frame, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const epubPath = resolve('tests/fixtures/books/alice.epub')
const pdfPath = resolve('tests/fixtures/books/tracemonkey.pdf')

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

    await page.locator('#settings-button').evaluate((button: HTMLElement) => button.click())
    await page.locator('[data-flow="paginated"]').click()
    await expect(page.locator('.continuous-ebook')).toHaveCount(0)
    const wrong = await replaceStoredEbookCfiWithWrongValidCfi(page, selectedText)
    await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#welcome-view')).toBeVisible()
    await page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect(page.locator('.continuous-ebook')).toHaveCount(0)
    await chapterFrame(page)
    await expectPaginatedHighlightAligned(page, selectedText, wrong.wrongText)

    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('.annotation-item q')).toContainText(selectedText)
    const repaired = await firstStoredAnnotation(page)
    expect(repaired.locator).not.toBe(wrong.wrongCfi)
    expect(repaired.anchor.cfi).toBe(repaired.locator)
    expect(repaired.anchor.quote.exact).toBe(selectedText)
  } finally {
    await context.close()
  }
})

test('PDF highlight rebuilds its rectangle after zoom, stale geometry and reopen', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await page.locator('#file-input').setInputFiles(pdfPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => page.locator('.pdf-page[data-page="1"] .textLayer span').count()).toBeGreaterThan(0)
    const selectedText = await selectPdfText(page)
    await expect(page.locator('#selection-ai-menu')).toBeHidden()
    await expect(page.locator('#ai-selection-preview')).toHaveText('选中文字后，可以解释、翻译或补充背景。')

    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    await page.locator('#highlight-selection').click()
    await expect(page.locator('.annotation-item q')).toContainText(selectedText)
    const stored = await firstStoredAnnotation(page)
    expect(stored.anchor).toMatchObject({
      version: 1,
      kind: 'pdf',
      page: 1,
      textOffset: expect.any(Number),
    })
    expect(stored.anchor.quote.exact).toBe(selectedText)

    await page.locator('#close-tools').click()
    for (let index = 0; index < 3; index += 1) await page.locator('#pdf-zoom-in').click()
    await expect(page.locator('#pdf-zoom-label')).toHaveText('130%')
    await expect.poll(() => page.locator('.pdf-page[data-page="1"] .pdf-annotation-layer span').count()).toBeGreaterThan(0)
    await expectPdfHighlightAligned(page, selectedText)

    await corruptStoredPdfRects(page)
    await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#welcome-view')).toBeVisible()
    await page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => page.locator('.pdf-page[data-page="1"] .pdf-annotation-layer span').count()).toBeGreaterThan(0)
    await expectPdfHighlightAligned(page, selectedText)

    const repaired = await firstStoredAnnotation(page)
    expect(repaired.anchor.quote.exact).toBe(selectedText)
    expect(repaired.rects[0].left).toBeLessThan(0.8)

    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    const downloadPromise = page.waitForEvent('download')
    await page.locator('#export-annotations-json').click()
    const archive = await downloadPromise
    const archivePath = await archive.path()
    if (!archivePath) throw new Error('PDF annotation archive path unavailable')
    await page.locator('#annotation-select-all').click()
    page.once('dialog', dialog => dialog.accept())
    await page.locator('#annotation-delete-selected').click()
    await expect(page.locator('.annotation-item')).toHaveCount(0)
    await page.locator('#annotation-import-input').setInputFiles(archivePath)
    await expect(page.locator('.annotation-item')).toHaveCount(1)
    await expect(page.locator('.annotation-anchor-status')).toHaveCount(0)
    await page.locator('#close-tools').click()
    await expect.poll(() => page.locator('.pdf-page[data-page="1"] .pdf-annotation-layer span').count()).toBeGreaterThan(0)
    await expectPdfHighlightAligned(page, selectedText)
  } finally {
    await context.close()
  }
})

async function selectPdfText(page: Page) {
  return page.locator('.pdf-page[data-page="1"] .textLayer').evaluate((textLayer: HTMLElement) => {
    const span = [...textLayer.querySelectorAll('span')]
      .find(item => (item.textContent || '').trim().length >= 12)
    const node = span?.firstChild
    if (!span || !node) throw new Error('No selectable PDF text span')
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    textLayer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return selection?.toString().trim() || ''
  })
}

async function expectPdfHighlightAligned(page: Page, selectedText: string) {
  const overlay = page.locator('.pdf-page[data-page="1"] .pdf-annotation-layer span').first()
  await expect(overlay).toHaveAttribute('title', selectedText)
  const target = page.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: selectedText }).first()
  const [overlayBox, targetBox] = await Promise.all([overlay.boundingBox(), target.boundingBox()])
  expect(overlayBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  expect(Math.abs(overlayBox!.x - targetBox!.x)).toBeLessThan(5)
  expect(Math.abs(overlayBox!.y - targetBox!.y)).toBeLessThan(5)
  expect(Math.abs(overlayBox!.width - targetBox!.width)).toBeLessThan(9)
}

async function corruptStoredPdfRects(page: Page) {
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
        record.annotations[0].rects = [{ left: 0.8, top: 0.8, width: 0.1, height: 0.05 }]
        store.put(record)
      }
      transaction.oncomplete = () => resolvePromise()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  })
}

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

async function replaceStoredEbookCfiWithWrongValidCfi(page: Page, selectedText: string) {
  return page.evaluate(async selected => {
    const view: any = document.querySelector('foliate-view')
    const content = view?.renderer?.getContents?.().find((item: any) =>
      item.doc?.body?.textContent?.includes(selected))
    if (!content) throw new Error('No loaded Foliate document for stale CFI fixture')
    const walker = content.doc.createTreeWalker(content.doc.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && ((node.textContent || '').includes(selected) || (node.textContent || '').trim().length < 20)) {
      node = walker.nextNode()
    }
    if (!node) throw new Error('No alternate EPUB text for stale CFI fixture')
    const start = Math.max(0, (node.textContent || '').search(/\S/))
    const end = Math.min((node.textContent || '').length, start + 18)
    const range = content.doc.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    const wrongText = range.toString().trim()
    const wrongCfi = view.getCFI(content.index, range)
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
        record.annotations[0].locator = wrongCfi
        record.annotations[0].anchor.cfi = wrongCfi
        record.annotations[0].anchor.previousCfi = wrongCfi
        store.put(record)
      }
      transaction.oncomplete = () => resolvePromise()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    return { wrongText, wrongCfi }
  }, selectedText)
}

async function expectPaginatedHighlightAligned(page: Page, selectedText: string, wrongText: string) {
  await expect.poll(() => page.evaluate(({ selected, wrong }) => {
    const view: any = document.querySelector('foliate-view')
    const content = view?.renderer?.getContents?.().find((item: any) =>
      item.doc?.body?.textContent?.includes(selected))
    if (!content?.overlayer) return { groupCount: 0, selectedHit: false, wrongHit: false }
    const rangeFor = (text: string) => {
      const walker = content.doc.createTreeWalker(content.doc.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && !(node.textContent || '').includes(text)) node = walker.nextNode()
      if (!node) return null
      const start = (node.textContent || '').indexOf(text)
      const range = content.doc.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + text.length)
      return range.getBoundingClientRect()
    }
    const selectedRect = rangeFor(selected)
    const wrongRect = rangeFor(wrong)
    const groups = [...content.overlayer.element.querySelectorAll(':scope > g')]
    const overlayRects = groups.flatMap((group: Element) =>
      [...group.querySelectorAll('rect')].map(rect => ({
        left: Number(rect.getAttribute('x')),
        top: Number(rect.getAttribute('y')),
        right: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')),
        bottom: Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')),
      })))
    const intersects = (left: DOMRect | null, right: { left: number, top: number, right: number, bottom: number }) => Boolean(left
      && Math.min(left.right, right.right) > Math.max(left.left, right.left)
      && Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top))
    return {
      groupCount: groups.length,
      selectedHit: overlayRects.some(rect => intersects(selectedRect, rect)),
      wrongHit: overlayRects.some(rect => intersects(wrongRect, rect)),
    }
  }, { selected: selectedText, wrong: wrongText })).toEqual({
    groupCount: 1,
    selectedHit: true,
    wrongHit: false,
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
    acceptDownloads: true,
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
