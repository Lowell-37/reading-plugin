import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { launchExtension } from './helpers/extension-launch'

const extension = resolve('.output/chrome-mv3')
const realPdf = resolve('tests/fixtures/books/tracemonkey.pdf')

test.describe('@wxt-pdf-session', () => {
  test('direct viewport scrolling updates page and progress, survives close and reopen', async () => {
    const { context, page, pageErrors } = await launchExtension(extension)
    try {
      await page.locator('#file-input').setInputFiles(realPdf)
      await expectPdfPage(page, 1)
      // Move only the browser scroll position: no page input, store command, or goTo.
      await page.locator('#pdf-viewport').evaluate((viewport: HTMLElement) => {
        const target = viewport.querySelector<HTMLElement>('.pdf-page[data-page="4"]')!
        viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      })
      await expectPdfPage(page, 4)
      await expect.poll(async () => Number(await page.locator('#progress-slider').inputValue())).toBeCloseTo(3 / 13, 5)
      await click(page, '#home-button')
      await expect(page.locator('#welcome-view')).toBeVisible()
      await expect.poll(async () => (await pdfRecords(page))[0]?.progress?.page).toBe(4)
      await page.reload()
      await page.locator('.library-card').click()
      await expectPdfPage(page, 4)
      await click(page, '#next-button')
      await expectPdfPage(page, 5)
      expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
    } finally { await context.close() }
  })

  test('real PDF text, page outline, navigation, zoom bounds and durable reopening', async () => {
    const { context, page, pageErrors } = await launchExtension(extension)
    try {
      await page.locator('#file-input').setInputFiles(realPdf)
      await expect(page.locator('#loading-view')).toBeHidden()
      await expect(page.locator('#reader-view')).toHaveClass(/pdf-session-active/)
      await expect(page.locator('#pdf-page-total')).toHaveText('/ 14')
      await expect(page.locator('.pdf-page[data-page="1"] .textLayer')).toContainText('Trace-based Just-in-Time')
      await expect(page.locator('#pdf-zoom-label')).toHaveText('100%')
      const baseWidth = await canvasWidth(page, 1)
      // This real paper has no embedded bookmarks; named-outline navigation is covered below.
      await expect(page.locator('#toc button')).toHaveCount(0)
      await jump(page, 3)
      await expectPdfPage(page, 3)
      await click(page, '#next-button')
      await expectPdfPage(page, 4)
      await click(page, '#prev-button')
      await expectPdfPage(page, 3)
      await jump(page, 6)
      await expectPdfPage(page, 6)
      await page.locator('#progress-slider').evaluate((input: HTMLInputElement) => {
        input.value = '1'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await expectPdfPage(page, 14)
      await expect(page.locator('#progress-label')).toHaveText('100%')
      await jump(page, 1)
      for (let step = 0; step < 3; step++) await click(page, '#pdf-zoom-in')
      await expectZoom(page, '130%', 1, baseWidth * 1.3)
      for (let step = 0; step < 14; step++) await click(page, '#pdf-zoom-in')
      await expectZoom(page, '250%', 1, baseWidth * 2.5)
      for (let step = 0; step < 21; step++) await click(page, '#pdf-zoom-out')
      await expectZoom(page, '60%', 1, baseWidth * 0.6)
      await click(page, '#pdf-fit-width')
      await expectZoom(page, '100%', 1, baseWidth)
      await jump(page, 7)
      await expectPdfPage(page, 7)
      await click(page, '#home-button')
      await expect(page.locator('#welcome-view')).toBeVisible()
      await expect.poll(async () => (await pdfRecords(page))[0]?.progress?.page).toBe(7)
      await page.reload()
      await page.locator('.library-card').click()
      await expectPdfPage(page, 7)
      await expect.poll(async () => Number(await page.locator('#progress-slider').inputValue())).toBeCloseTo(6 / 13, 5)
      expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
    } finally { await context.close() }
  })

  for (const kind of ['malformed', 'password'] as const) {
    test(`${kind} PDF displays only a safe error and can recover`, async () => {
      const { context, page, pageErrors } = await launchExtension(extension)
      try {
        await page.locator('#file-input').setInputFiles({
          name: `${kind}.pdf`, mimeType: 'application/pdf',
          buffer: kind === 'password' ? fixturePdf(true) : Buffer.from('%PDF-1.7\nprivate-engine-diagnostic-invalid'),
        })
        await expect(page.locator('#loading-view')).toHaveAttribute('data-state', 'error')
        await expect(page.locator('#loading-title')).toHaveText(kind === 'password' ? 'PDF 需要密码' : '无法解析 PDF')
        await expect(page.locator('#loading-detail')).toHaveText(kind === 'password'
          ? '请输入正确密码后重试。' : '文件内容无法解析。请确认文件完整后重试。')
        await expect(page.locator('#loading-view')).not.toContainText(/Exception|Invalid PDF|private-engine|PasswordException/)
        await expect(page.locator('.pdf-page')).toHaveCount(0)
        await page.locator('#loading-library-button').click()
        await expect(page.locator('#welcome-view')).toBeVisible()
        await page.locator('#file-input').setInputFiles(realPdf)
        await expectPdfPage(page, 1)
        await expect(page.locator('.pdf-page[data-page="1"] .textLayer')).toContainText('Trace-based Just-in-Time')
        expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
      } finally { await context.close() }
    })
  }

  test('rapid two-record opening keeps only the second title, pages, outline and progress', async () => {
    const { context, page, pageErrors } = await launchExtension(extension)
    try {
      const first = await readFile(realPdf)
      // Dispatch both real file imports in one browser task, before parsing can finish.
      await page.locator('#file-input').evaluate((input: HTMLInputElement, files) => {
        for (const file of files) {
          const transfer = new DataTransfer()
          transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: 'application/pdf' }))
          input.files = transfer.files
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }, [{ name: 'first-tracemonkey.pdf', bytes: [...first] }, { name: 'second.pdf', bytes: [...fixturePdf()] }])
      await expect(page.locator('#loading-view')).toBeHidden()
      await expect(page.locator('#header-title')).toHaveText('Second PDF')
      await expect(page.locator('#pdf-page-total')).toHaveText('/ 2')
      await expect(page.locator('.pdf-page')).toHaveCount(2)
      await expect(page.locator('#toc button')).toHaveText(['Second destination'])
      await page.locator('#toc button').evaluate((button: HTMLElement) => button.click())
      await expectPdfPage(page, 2)
      await expect(page.locator('.pdf-page[data-page="2"] .textLayer')).toContainText('Second session page two')
      await expect(page.locator('#progress-label')).toHaveText('100%')
      await click(page, '#home-button')
      await expect.poll(async () => (await pdfRecords(page)).find(record => record.name === 'second.pdf')?.progress?.page).toBe(2)
      const records = await pdfRecords(page)
      expect(records).toHaveLength(2)
      expect(records.find(record => record.name === 'first-tracemonkey.pdf')?.progress).toBeUndefined()
      await page.locator('.library-card').filter({ hasText: /second/i }).click()
      await expectPdfPage(page, 2)
      await expect(page.locator('#header-title')).toHaveText('Second PDF')
      await expect(page.locator('.pdf-page')).toHaveCount(2)
      expect(pageErrors.map(error => error.stack || error.message)).toEqual([])
    } finally { await context.close() }
  })
})

async function click(page: Page, selector: string) {
  await page.locator(selector).evaluate((element: HTMLElement) => element.click())
}

async function jump(page: Page, number: number) {
  await page.locator('#pdf-page-input').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value)
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, number)
}

async function expectPdfPage(page: Page, number: number) {
  await expect(page.locator('#pdf-page-input')).toHaveValue(String(number))
  await expect(page.locator(`.pdf-page[data-page="${number}"]`)).toHaveAttribute('data-state', 'rendered')
  await expect(page.locator(`.pdf-page[data-page="${number}"] .textLayer`)).not.toBeEmpty()
  await expect(page.locator('#chapter-label')).toContainText(`第 ${number} 页`)
}

async function expectZoom(page: Page, label: string, number: number, expectedWidth: number) {
  await expect(page.locator('#pdf-zoom-label')).toHaveText(label)
  await expectPdfPage(page, number)
  expect(Math.abs(await canvasWidth(page, number) - expectedWidth)).toBeLessThan(3)
}

async function canvasWidth(page: Page, number: number) {
  return page.locator(`.pdf-page[data-page="${number}"] canvas`).evaluate(canvas => (canvas as HTMLCanvasElement).width)
}

async function pdfRecords(page: Page): Promise<Array<{ name: string, progress?: { page: number, fraction: number } }>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('quiet-reader', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const request = db.transaction('books').objectStore('books').getAll()
        request.onsuccess = () => resolve(request.result.map(({ name, progress }) => ({ name, progress })))
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
}

// Small self-contained PDF syntax fixture: real PDF.js parsing/rendering, never an engine mock.
// Standard security R2 with nonmatching password entries exercises PasswordException before content parsing.
function fixturePdf(encrypted = false) {
  const stream = 'BT /F1 18 Tf 40 700 Td (Second session page two) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 1 >>',
    '<< /Title (Second destination) /Parent 7 0 R /Dest [4 0 R /Fit] >>',
    '<< /Title (Second PDF) >>',
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`,
  ]
  let content = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content))
    content += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(content)
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  content += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 9 0 R ${encrypted ? '/Encrypt 10 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]' : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(content)
}
