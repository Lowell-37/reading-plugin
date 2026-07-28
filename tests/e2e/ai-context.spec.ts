import { test, expect, chromium, type Frame } from '@playwright/test'
import { resolve } from 'node:path'

test('real EPUB exposes chapter text and selection to the AI controls', async () => {
  const extensionPath = resolve('.output/chrome-mv3')
  const context = await chromium.launchPersistentContext('', {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
    const page = await context.newPage()
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`)
    await page.locator('#file-input').setInputFiles(resolve('tests/fixtures/books/alice.epub'))
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await page.locator('#toc button').nth(3).evaluate((button: HTMLButtonElement) => button.click())

    const chapterFrame = await expect.poll(async () => findChapterFrame(page.frames()), {
      message: 'a rendered chapter iframe with extractable text',
    }).not.toBeNull().then(() => findChapterFrame(page.frames()))
    expect(chapterFrame).not.toBeNull()
    const text = await chapterFrame!.locator('body').innerText()
    expect(text.length).toBeGreaterThan(200)
    expect(text).toMatch(/Alice/i)

    await chapterFrame!.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && !(node.textContent || '').trim()) node = walker.nextNode()
      if (!node) throw new Error('No selectable chapter text')
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, Math.min(40, node.textContent?.length || 0))
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await expect(page.locator('#ai-selection-preview')).not.toHaveText('选中文字后，可以解释、翻译或补充背景。')
    await expect(page.locator('#selection-ai-menu')).toBeVisible()
  } finally {
    await context.close()
  }
})

async function findChapterFrame(frames: Frame[]): Promise<Frame | null> {
  for (const frame of frames.slice(1)) {
    const text = await frame.locator('body').innerText().catch(() => '')
    if (text.length > 200 && /Alice/i.test(text)) return frame
  }
  return null
}
