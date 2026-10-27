import { expect, test, type Frame, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'

const wxtExtension = resolve('.output/chrome-mv3')
const bookPath = resolve('tests/fixtures/books/alice.epub')

test('@wxt-vue dismissing a reader panel restores focus to its header button', async () => {
  const { context, page, pageErrors } = await launchExtension(wxtExtension)
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(3)
    const focusedId = () => page.evaluate(() => document.activeElement?.id)

    await page.locator('#sidebar-button').click()
    await page.locator('#toc button').first().focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/)
    await expect.poll(focusedId).toBe('sidebar-button')

    await page.locator('#settings-button').click()
    await page.locator('#close-settings').click()
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/)
    await expect.poll(focusedId).toBe('settings-button')

    await page.locator('#tools-button').click()
    await page.locator('#search-input').focus()
    await page.locator('#scrim').click()
    await expect(page.locator('#tools-panel')).not.toHaveClass(/open/)
    await expect.poll(focusedId).toBe('tools-button')
    expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
  } finally { await context.close() }
})

test('@wxt-vue closed reader panels are absent from Tab order and the accessibility tree', async () => {
  const { context, page, pageErrors } = await launchExtension(wxtExtension)
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(3)

    const panelFocus = () => page.evaluate(() => document.activeElement?.closest('#sidebar, #settings-panel, #tools-panel')?.id ?? null)
    await page.locator('#header-toggle').focus()
    await page.keyboard.press('Tab')
    expect(await panelFocus()).toBeNull()
    await page.locator('#progress-slider').focus()
    await page.keyboard.press('Tab')
    expect(await panelFocus()).toBeNull()

    const cdp = await context.newCDPSession(page)
    const accessibleRole = async (selector: string) => {
      const { root } = await cdp.send('DOM.getDocument')
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId })
      return nodes[0]?.ignored ? null : nodes[0]?.role?.value
    }
    const panels = [
      { trigger: '#sidebar-button', selector: '#sidebar', action: '#toc button' },
      { trigger: '#settings-button', selector: '#settings-panel', action: '#close-settings' },
      { trigger: '#tools-button', selector: '#tools-panel', action: '#close-tools' },
    ]
    for (const panel of panels) {
      expect(await accessibleRole(panel.selector)).toBeNull()
      await page.locator(panel.trigger).click()
      expect(await accessibleRole(panel.selector)).toBe('complementary')
      const action = page.locator(panel.action).first()
      await action.focus()
      expect(await panelFocus()).toBe(panel.selector.slice(1))
      await page.keyboard.press('Enter')
      await expect.poll(() => accessibleRole(panel.selector)).toBeNull()
    }
    await cdp.detach()
    expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
  } finally { await context.close() }
})

test('@wxt-vue Vue library imports, reopens, deletes and restores a real annotated EPUB', async () => {
  const { context, page, pageErrors } = await launchExtension(wxtExtension)
  try {
    await page.locator('#file-input').setInputFiles(bookPath)
    await expect(page.locator('body')).toHaveClass(/is-reading/)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(3)

    const initialProgress = await progress(page)
    await page.locator('#sidebar-button').click()
    await page.locator('#toc button').nth(3).click()
    await expect.poll(() => progress(page)).toBeGreaterThan(initialProgress)
    await selectText(await chapterFrame(page))
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/)
    await expect(page.locator('#scrim')).not.toHaveClass(/show/)
    await page.locator('#tools-button').click()
    page.once('dialog', dialog => dialog.accept('Vue library annotation'))
    await page.locator('#note-selection').click()
    await expect(page.locator('.annotation-item')).toContainText('Vue library annotation')

    await page.locator('#scrim').click()
    await page.locator('#home-button').click()
    await expect(page.locator('#welcome-view')).toBeVisible()
    await expect(page.locator('.library-card')).toHaveCount(1)
    const saved = await storedBookState(page)
    expect(saved.progress).toBeGreaterThan(0)
    expect(saved.notes).toContain('Vue library annotation')

    await page.reload()
    await expect(page.locator('.library-card')).toHaveCount(1)
    await page.locator('.library-card').click()
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(saved.progress * 0.8)
    await page.locator('#tools-button').click()
    await expect(page.locator('.annotation-item')).toContainText('Vue library annotation')

    await page.locator('#scrim').click()
    await page.locator('#home-button').click()
    const downloadPromise = page.waitForEvent('download')
    await page.locator('#backup-library').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.quietreader$/)
    const backupPath = await download.path()
    expect(backupPath).toBeTruthy()
    await expect(page.locator('#backup-status')).toHaveAttribute('data-state', 'exported')

    await page.locator('.delete-book').click()
    await expect(page.locator('.library-card')).toHaveCount(0)
    await page.locator('#backup-file-input').setInputFiles(backupPath!)
    await expect(page.locator('#backup-status')).toHaveAttribute('data-state', 'restored')
    await expect(page.locator('.library-card')).toHaveCount(1)

    await page.locator('.library-card').click()
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(saved.progress * 0.8)
    await page.locator('#tools-button').click()
    await expect(page.locator('.annotation-item')).toContainText('Vue library annotation')
    const restored = await storedBookState(page)
    expect(restored.progress).toBeGreaterThanOrEqual(saved.progress * 0.8)
    expect(restored.notes).toContain('Vue library annotation')
    expect(pageErrors).toEqual([])
  } finally {
    await context.close()
  }
})

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
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

async function selectText(frame: Frame) {
  await frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && (node.textContent || '').trim().length <= 24) node = walker.nextNode()
    if (!node) throw new Error('No selectable chapter text')
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, Math.min(32, node.textContent?.length || 0))
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function storedBookState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open('quiet-reader', 2)
      request.onsuccess = () => resolveDatabase(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const record = await new Promise<any>((resolveRecord, reject) => {
        const request = database.transaction('books', 'readonly').objectStore('books').getAll()
        request.onsuccess = () => resolveRecord(request.result[0])
        request.onerror = () => reject(request.error)
      })
      return {
        progress: Number(record?.progress?.fraction) || 0,
        notes: (record?.annotations || []).map((annotation: { note?: string }) => annotation.note || ''),
      }
    } finally {
      database.close()
    }
  })
}
