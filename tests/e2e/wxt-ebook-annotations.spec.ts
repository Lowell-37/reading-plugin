import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { launchExtension } from './helpers/extension-launch'

const extension = resolve('.output/chrome-mv3')
const books = resolve('tests/fixtures/books')

test.describe('@wxt-annotations', () => {
  for (const format of ['epub', 'mobi', 'azw3'] as const) {
    test(`WXT creates, edits and restores a real ${format.toUpperCase()} highlight`, async () => {
      const { context, page, pageErrors } = await launchExtension(extension)
      try {
        await page.locator('#file-input').setInputFiles(resolve(books, `alice.${format}`))
        await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
        await page.locator('#sidebar-button').click()
        await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(5)
        await page.locator('#toc button').nth(5).click()
        await page.locator('#sidebar-button').evaluate((button: HTMLElement) => button.click())
        await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
        await selectVisibleText(page)
        await page.locator('#highlight-selection').click()
        await expect(page.locator('#annotation-count')).toHaveText('1 条')
        await expect(page.locator('#annotation-list .annotation-item')).toHaveCount(1)
        await expect.poll(() => visiblePaginatedHighlights(page)).toBeGreaterThan(0)
        let dialogIndex = 0
        const acceptEdit = (dialog: import('@playwright/test').Dialog) => {
          void dialog.accept(dialogIndex++ === 0 ? 'Important passage' : 'review')
          if (dialogIndex === 2) page.off('dialog', acceptEdit)
        }
        page.on('dialog', acceptEdit)
        await page.locator('#annotation-list .annotation-item .text-button').first().evaluate((button: HTMLElement) => button.click())
        await expect(page.locator('#annotation-list .annotation-item')).toContainText('Important passage')
        await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
        await page.reload()
        await page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
        await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
        await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
        await expect(page.locator('#annotation-count')).toHaveText('1 条')
        await expect(page.locator('#annotation-list .annotation-item')).toContainText('Important passage')
        const downloadPromise = page.waitForEvent('download')
        await page.locator('#export-annotations-json').evaluate((button: HTMLElement) => button.click())
        const download = await downloadPromise
        const archivePath = await download.path()
        if (!archivePath) throw new Error('Annotation export path unavailable')
        const archive = JSON.parse(await readFile(archivePath, 'utf8'))
        expect(archive.annotations).toHaveLength(1)
        expect(archive.annotations[0]).toMatchObject({ kind: 'ebook', note: 'Important passage' })
        page.once('dialog', dialog => { void dialog.accept() })
        await page.locator('#annotation-list .annotation-item .danger').evaluate((button: HTMLElement) => button.click())
        await expect(page.locator('#annotation-count')).toHaveText('0 条')
        await page.locator('#annotation-import-input').setInputFiles(archivePath)
        await expect(page.locator('#annotation-count')).toHaveText('1 条')
        await expect(page.locator('#annotation-list .annotation-item')).toContainText('Important passage')
        expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
      } finally {
        await context.close()
      }
    })
  }

  test('WXT creates and removes a highlight in continuous EPUB mode', async () => {
    const { context, page, pageErrors } = await launchExtension(extension)
    try {
      await page.locator('#file-input').setInputFiles(resolve(books, 'alice.epub'))
      await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
      await page.locator('#sidebar-button').evaluate((button: HTMLElement) => button.click())
      await page.locator('#toc button').nth(5).evaluate((button: HTMLElement) => button.click())
      await page.locator('#settings-button').evaluate((button: HTMLElement) => button.click())
      await page.locator('[data-flow="scrolled"]').evaluate((button: HTMLElement) => button.click())
      await expect(page.locator('.continuous-ebook')).toBeVisible()
      await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
      await selectVisibleText(page, true)
      await page.locator('#highlight-selection').evaluate((button: HTMLElement) => button.click())
      await expect(page.locator('#annotation-count')).toHaveText('1 条')
      await expect.poll(async () => page.locator('.continuous-section > svg > g').count()).toBeGreaterThan(0)
      page.once('dialog', dialog => { void dialog.accept() })
      await page.locator('#annotation-list .annotation-item .danger').evaluate((button: HTMLElement) => button.click())
      await expect(page.locator('#annotation-count')).toHaveText('0 条')
      await expect(page.locator('.continuous-section > svg > g')).toHaveCount(0)
      expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
    } finally {
      await context.close()
    }
  })
})

async function selectVisibleText(page: Page, scrolled = false) {
  await expect.poll(() => page.evaluate(() => {
    const frames = [...document.querySelectorAll<HTMLIFrameElement>('.continuous-section-frame')]
    if (frames.length) return frames.some(frame => Boolean(frame.contentDocument?.body?.textContent?.trim()))
    const view = document.querySelector<HTMLElement & { getContents?: () => Array<{ doc?: Document }>, renderer?: { getContents?: () => Array<{ doc?: Document }> } }>('#ebook-host foliate-view')
    return (view?.getContents?.() ?? view?.renderer?.getContents?.() ?? []).some(content => Boolean(content.doc?.body?.textContent?.trim()))
  })).toBe(true)
  await page.evaluate((continuous) => {
    const view = document.querySelector<HTMLElement & { getContents?: () => Array<{ doc?: Document }>, renderer?: { getContents?: () => Array<{ doc?: Document }> } }>('#ebook-host foliate-view')
    const doc = continuous
      ? [...document.querySelectorAll<HTMLIFrameElement>('.continuous-section-frame')].find(frame => frame.contentDocument?.body?.textContent?.trim())?.contentDocument
      : (view?.getContents?.() ?? view?.renderer?.getContents?.() ?? []).find(content => content.doc?.body?.textContent?.trim())?.doc
    if (!doc) throw new Error('No rendered ebook document')
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let node: Node | null = null
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim() && node.textContent.length > 4) break
    }
    if (!node) throw new Error('No selectable ebook text')
    const range = doc.createRange()
    range.setStart(node, 0)
    range.setEnd(node, Math.min(node.textContent?.length ?? 0, 20))
    const selection = doc.defaultView?.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, scrolled)
}

async function visiblePaginatedHighlights(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector<HTMLElement & { renderer?: { getContents?: () => Array<{ overlayer?: { element?: Element } }> } }>('#ebook-host foliate-view')
    return (view?.renderer?.getContents?.() ?? []).reduce((count, content) =>
      count + (content.overlayer?.element?.querySelectorAll(':scope > g').length ?? 0), 0)
  })
}
