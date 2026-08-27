import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'

const rootExtension = resolve('.')
const wxtExtension = resolve('.output/chrome-mv3')
const booksPath = resolve('tests/fixtures/books')

test.describe('@wxt', () => {
test('WXT build keeps the root extension identity and opens the reader shell', async () => {
  const root = await launchExtension(rootExtension)
  const rootExtensionId = root.extensionId
  await root.context.close()

  const wxt = await launchExtension(wxtExtension)
  try {
    expect(wxt.extensionId).toBe(rootExtensionId)
    await expect(wxt.page.locator('#welcome-view')).toBeVisible()
    await expect(wxt.page.locator('#file-input')).toHaveAttribute('accept', /\.epub/)
    await expect(wxt.page.locator('.ai-section')).toBeHidden()
    await expect(wxt.page.locator('[data-ai-action]').first()).toBeHidden()
  } finally {
    await wxt.context.close()
  }
})

for (const format of ['epub', 'mobi', 'azw3'] as const) {
  test(`WXT opens a real ${format.toUpperCase()} with TOC and progress`, async () => {
    const { context, page } = await launchExtension(wxtExtension)
    try {
      await openBook(page, `alice.${format}`)
      await expect(page.locator('#sidebar-title')).toContainText(/Alice/i)
      await expect.poll(async () => page.locator('#toc button').count()).toBeGreaterThan(2)

      await page.locator('#toc button').nth(2).evaluate((element: HTMLElement) => element.click())
      await expect.poll(() => progress(page)).toBeGreaterThan(0)
    } finally {
      await context.close()
    }
  })
}

test('WXT renders a real PDF text layer, page jump and zoom', async () => {
  const { context, page } = await launchExtension(wxtExtension)
  try {
    await openBook(page, 'tracemonkey.pdf')
    await expect(page.locator('#ebook-host')).toBeHidden()
    await expect(page.locator('#pdf-page-total')).not.toHaveText('/ 1')
    await expect.poll(async () => page.locator('.textLayer span').count()).toBeGreaterThan(0)

    await page.locator('#pdf-zoom-in').evaluate((element: HTMLElement) => element.click())
    await expect(page.locator('#pdf-zoom-label')).toHaveText('110%')
    await page.locator('#pdf-page-input').evaluate((input: HTMLInputElement) => {
      input.value = '3'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.locator('#pdf-page-input')).toHaveValue('3')
    await expect.poll(() => progress(page)).toBeGreaterThan(0)
  } finally {
    await context.close()
  }
})

async function openBook(page: Page, name: string) {
  await page.locator('#file-input').setInputFiles(resolve(booksPath, name))
  await expect(page.locator('body')).toHaveClass(/is-reading/)
  await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}
})
