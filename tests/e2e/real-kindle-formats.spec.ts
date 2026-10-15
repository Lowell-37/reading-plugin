import { test, expect, type Frame, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'

const extensionPath = resolve('.')
const booksPath = resolve('tests/fixtures/books')

test('Project Gutenberg Frankenstein MOBI navigates real chapters and restores the last chapter', async () => {
  const { context, page, pageErrors } = await launchExtension(extensionPath)
  try {
    await openBook(page, 'frankenstein-gutenberg.mobi')
    await expect(page.locator('#sidebar-title')).toContainText('Frankenstein')
    const toc = page.locator('#toc button')
    await expect.poll(() => toc.count()).toBeGreaterThan(20)
    await expect(toc.filter({ hasText: /^Chapter \d+$/ })).toHaveText(
      Array.from({ length: 24 }, (_, index) => `Chapter ${index + 1}`),
    )
    await toc.filter({ hasText: /^Chapter 24$/ }).evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => readableText(page.frames())).toContain('My present situation was one in which all voluntary thought was swallowed up and lost.')
    await expect(page.locator('#toc button.active')).toHaveText('Chapter 24')
    await expect.poll(() => progress(page)).toBeGreaterThan(0.8)
    const savedProgress = await progress(page)

    await reopenBook(page, /Frankenstein/i)
    await expect.poll(() => progress(page)).toBeCloseTo(savedProgress, 2)
    await expect(page.locator('#toc button.active')).toHaveText('Chapter 24')
    await expect.poll(() => readableText(page.frames())).toContain('My present situation was one in which all voluntary thought was swallowed up and lost.')
    expect(pageErrors).toEqual([])
  } finally {
    await context.close()
  }
})

test('GITenberg Chinese MOBI with license-only TOC shows readable text and restores position', async () => {
  const { context, page, pageErrors } = await launchExtension(extensionPath)
  try {
    await openBook(page, 'water-margin-gitenberg.mobi')
    await expect(page.locator('#sidebar-title')).toContainText('水滸傳')
    await expect(page.locator('#toc button')).toHaveCount(6)
    await expect(page.locator('#toc button').first()).toContainText('FULL LICENSE')
    await page.locator('#progress-slider').evaluate((input: HTMLInputElement) => {
      input.value = '0.5'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect.poll(() => progress(page)).toBeGreaterThan(0.49)
    await expect.poll(() => readableText(page.frames())).toMatch(/[\u4e00-\u9fff]{10}/)
    await expect.poll(() => readableText(page.frames())).toContain('只說宋江自和兩防送公人取路投江州來')
    const savedProgress = await progress(page)

    await reopenBook(page, /水滸傳/i)
    await expect.poll(() => progress(page)).toBeCloseTo(savedProgress, 2)
    await expect.poll(() => readableText(page.frames())).toMatch(/[\u4e00-\u9fff]{10}/)
    await expect.poll(() => readableText(page.frames())).toContain('只說宋江自和兩防送公人取路投江州來')
    expect(pageErrors).toEqual([])
  } finally {
    await context.close()
  }
})

test('Standard Ebooks AZW3 reaches its final chapter and restores it', async () => {
  const { context, page, pageErrors } = await launchExtension(extensionPath)
  try {
    await openBook(page, 'dracula-standard-ebooks.azw3')
    await expect(page.locator('#sidebar-title')).toContainText('Dracula')
    await expect.poll(() => page.locator('#toc button').count()).toBeGreaterThan(20)
    await page.locator('#toc button').filter({ hasText: /^XXVII$/ }).first()
      .evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => readableText(page.frames())).toContain('Mina Harker’s Journal')
    await expect(page.locator('#toc button.active')).toHaveText('XXVII')
    await expect.poll(() => progress(page)).toBeGreaterThan(0.8)
    const savedProgress = await progress(page)

    await reopenBook(page, /Dracula/i)
    await expect.poll(() => progress(page)).toBeCloseTo(savedProgress, 2)
    await expect(page.locator('#toc button.active')).toHaveText('XXVII')
    await expect.poll(() => readableText(page.frames())).toContain('Mina Harker’s Journal')
    expect(pageErrors).toEqual([])
  } finally {
    await context.close()
  }
})

async function openBook(page: Page, filename: string) {
  await page.locator('#file-input').setInputFiles(resolve(booksPath, filename))
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
  await expect(page.locator('body')).toHaveClass(/is-reading/)
}

async function reopenBook(page: Page, title: RegExp) {
  await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
  await expect(page.locator('#welcome-view')).toBeVisible()
  await page.locator('.library-card').filter({ hasText: title }).first()
    .evaluate((card: HTMLElement) => card.click())
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}

async function readableText(frames: Frame[]) {
  return (await Promise.all(frames.slice(1).map(frame =>
    frame.locator('body').innerText().catch(() => ''),
  ))).join('\n').replace(/\u00ad/g, '')
}
