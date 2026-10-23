import { expect, type Page } from '@playwright/test'

export async function assertPdfReadingKeyboard(page: Page) {
  const intercepted = await page.evaluate(() => {
    const options = [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]
    return options.map(modifiers => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, ...modifiers })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  })
  expect(intercepted).toEqual([false, false, false, false, false])
  await expect(page.locator('#pdf-page-input')).toHaveValue('1')
  await page.keyboard.press('PageDown')
  await expect(page.locator('#pdf-page-input')).toHaveValue('2')
  await page.keyboard.press('PageUp')
  await expect(page.locator('#pdf-page-input')).toHaveValue('1')
}
