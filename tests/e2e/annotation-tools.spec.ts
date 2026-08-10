import { test, expect, chromium, type BrowserContext, type Dialog, type Download, type Frame, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/alice.epub')

test('organizes, exports, deletes and imports EPUB annotations', async () => {
  const { context, page } = await launchRootExtension()
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('body')).toHaveClass(/is-reading/)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await page.locator('#toc button').nth(3).evaluate((button: HTMLElement) => button.click())
    const frame = await chapterFrame(page)

    await selectText(frame, 0)
    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    page.once('dialog', dialog => dialog.accept('Original note'))
    await page.locator('#note-selection').click()
    await expect(page.locator('.annotation-item')).toHaveCount(1)
    await expect(page.locator('.annotation-item')).toContainText('Original note')

    const editReplies = ['Updated note', 'classic, key']
    const editDialog = (dialog: Dialog) => dialog.accept(editReplies.shift() || '')
    page.on('dialog', editDialog)
    await page.locator('.annotation-edit').click()
    await expect(page.locator('.annotation-item')).toContainText('Updated note')
    await expect(page.locator('.annotation-tags')).toContainText('classic')
    page.off('dialog', editDialog)

    await page.locator('#annotation-filter-query').fill('classic')
    await expect(page.locator('.annotation-item')).toHaveCount(1)
    await page.locator('#annotation-filter-query').fill('')

    await page.locator('#close-tools').click()
    await selectText(frame, 1)
    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    await page.locator('#highlight-selection').click()
    await expect(page.locator('.annotation-item')).toHaveCount(2)
    await expect(page.locator('#annotation-count')).toHaveText('2 条')

    await page.locator('#annotation-filter-type').selectOption('notes')
    await expect(page.locator('.annotation-item')).toHaveCount(1)
    await expect(page.locator('.annotation-item')).toContainText('Updated note')
    await expect(page.locator('#annotation-count')).toHaveText('1 / 2 条')
    await page.locator('#annotation-filter-query').fill('missing phrase')
    await expect(page.locator('.annotation-item')).toHaveCount(0)
    await expect(page.locator('.annotation-list')).toContainText('没有符合筛选条件')
    await page.locator('#annotation-filter-query').fill('')
    await page.locator('#annotation-filter-type').selectOption('all')
    await page.locator('#annotation-sort').selectOption('oldest')
    await expect(page.locator('#annotation-sort')).toHaveValue('oldest')

    await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#welcome-view')).toBeVisible()
    await page.locator('.library-card').first().evaluate((card: HTMLElement) => card.click())
    await expect(page.locator('body')).toHaveClass(/is-reading/)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await page.locator('#tools-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('.annotation-item')).toHaveCount(2)
    await expect(page.locator('.annotation-list')).toContainText('Updated note')
    await expect(page.locator('.annotation-tags')).toContainText('classic')

    const jsonDownload = page.waitForEvent('download')
    await page.locator('#export-annotations-json').click()
    const downloadedJson = await jsonDownload
    const jsonPath = await downloadedJson.path()
    if (!jsonPath) throw new Error('JSON download path is unavailable')
    const archive = JSON.parse(await readFile(jsonPath, 'utf8'))
    expect(archive.format).toBe('quiet-reader-annotations')
    expect(archive.book.title).toMatch(/Alice/i)
    expect(archive.annotations).toHaveLength(2)
    expect(archive.annotations.some((item: any) => item.note === 'Updated note')).toBe(true)
    expect(archive.annotations.some((item: any) => item.tags?.includes('classic'))).toBe(true)

    const markdownDownload = page.waitForEvent('download')
    await page.locator('#export-annotations-markdown').click()
    const markdown = await readDownload(await markdownDownload)
    expect(markdown).toMatch(/Alice/i)
    expect(markdown).toContain('Updated note')
    expect(markdown).toContain('> ')

    await page.locator('#annotation-select-all').click()
    await expect(page.locator('.annotation-select:checked')).toHaveCount(2)
    await expect(page.locator('#annotation-delete-selected')).toContainText('2')
    page.once('dialog', dialog => dialog.accept())
    await page.locator('#annotation-delete-selected').click()
    await expect(page.locator('.annotation-item')).toHaveCount(0)
    await expect(page.locator('#annotation-count')).toHaveText('0 条')

    await page.locator('#annotation-import-input').setInputFiles(jsonPath)
    await expect(page.locator('.annotation-item')).toHaveCount(2)
    await expect(page.locator('.annotation-list')).toContainText('Updated note')
    await expect(page.locator('.annotation-tags')).toContainText('classic')
    await expect(page.locator('#toast')).toContainText('新增 2')
  } finally {
    await context.close()
  }
})

async function selectText(frame: Frame, ordinal: number) {
  await frame.evaluate(targetOrdinal => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    let node = walker.nextNode()
    while (node) {
      if ((node.textContent || '').trim().length > 24) nodes.push(node)
      node = walker.nextNode()
    }
    const target = nodes[Math.min(targetOrdinal, nodes.length - 1)]
    if (!target) throw new Error('No selectable chapter text')
    const range = document.createRange()
    range.setStart(target, 0)
    range.setEnd(target, Math.min(32, target.textContent?.length || 0))
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, ordinal)
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

async function readDownload(download: Download) {
  const path = await download.path()
  if (!path) throw new Error('Download path is unavailable')
  return readFile(path, 'utf8')
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
