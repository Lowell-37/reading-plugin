import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'

const extensionPath = resolve('.')
const handbook = resolve('tests/fixtures/books/nasa-systems-engineering-handbook.pdf')

test('NASA handbook PDF navigates its outline, renders text and restores page 53', async () => {
  const { context, page, pageErrors } = await launchExtension(extensionPath)
  try {
    await page.locator('#file-input').setInputFiles(handbook)
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('body')).toHaveClass(/is-reading/)
    await expect(page.locator('#sidebar-title')).toContainText('NASA Systems Engineering Handbook')
    await expect(page.locator('#pdf-page-total')).toHaveText('/ 297')
    await expect(page.locator('.pdf-page[data-page="1"] .textLayer')).toContainText('SYSTEMS ENGINEERING')

    await page.locator('#toc button').filter({ hasText: '4.0 System Design Processes' })
      .evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#pdf-page-input')).toHaveValue('53')
    await expect(page.locator('.pdf-page[data-page="53"] .textLayer')).toContainText('System Design Processes')
    await expect.poll(() => scrollDistanceFromPage(page, 53)).toBeLessThan(5)
    const originalCanvasWidth = await page.locator('.pdf-page[data-page="53"] canvas')
      .evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width)
    await page.locator('#pdf-zoom-in').evaluate((button: HTMLElement) => button.click())
    await page.locator('#pdf-zoom-in').evaluate((button: HTMLElement) => button.click())
    await page.locator('#pdf-zoom-in').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#pdf-zoom-label')).toHaveText('130%')
    await expect(page.locator('#pdf-page-input')).toHaveValue('53')
    await expect.poll(() => page.locator('.pdf-page[data-page="53"] canvas')
      .evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width))
      .toBeGreaterThan(originalCanvasWidth * 1.25)
    const savedProgress = await progress(page)

    await page.locator('#home-button').evaluate((button: HTMLElement) => button.click())
    await expect(page.locator('#welcome-view')).toBeVisible()
    await page.locator('.library-card').filter({ hasText: /NASA Systems Engineering Handbook/i })
      .first().evaluate((card: HTMLElement) => card.click())
    await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('#pdf-page-input')).toHaveValue('53')
    await expect(page.locator('.pdf-page[data-page="53"] .textLayer')).toContainText('System Design Processes')
    await expect.poll(() => scrollDistanceFromPage(page, 53)).toBeLessThan(5)
    await expect.poll(() => progress(page)).toBeCloseTo(savedProgress, 2)
    expect(pageErrors).toEqual([])
  } finally {
    await context.close()
  }
})

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}

async function scrollDistanceFromPage(page: Page, pageNumber: number) {
  return page.locator('#pdf-viewport').evaluate((viewport: HTMLElement, number: number) => {
    const target = viewport.querySelector<HTMLElement>(`.pdf-page[data-page="${number}"]`)!
    return Math.abs(viewport.scrollTop - target.offsetTop)
  }, pageNumber)
}
