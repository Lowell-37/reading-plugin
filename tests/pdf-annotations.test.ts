// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import type { Annotation } from '../src/core/types'
import {
  clearPdfAnnotationOverlays,
  createPdfAnnotationFromRange,
  renderPdfAnnotationOverlays,
} from '../entrypoints/reader/pdf-annotations'

afterEach(() => {
  document.body.replaceChildren()
})

describe('rendered PDF annotations', () => {
  test('creates a stable PDF anchor from a same-page text selection', () => {
    const { page, layer } = renderedPage(7, 'Before ', 'selected ', 'words after')
    const range = document.createRange()
    range.setStart(layer.children[1]!.firstChild!, 0)
    range.setEnd(layer.children[2]!.firstChild!, 5)

    const annotation = createPdfAnnotationFromRange({ page, range, rects: rects(10, 20, 80, 18) })

    expect(annotation).toMatchObject({
      kind: 'pdf',
      page: 7,
      locator: 'page:7',
      text: 'selected words',
      anchorStatus: 'resolved',
      anchor: {
        version: 1,
        kind: 'pdf',
        page: 7,
        textOffset: 7,
        quote: { exact: 'selected words', normalizedExact: 'selected words' },
      },
    })
    expect(annotation?.rects).toEqual([{ left: 0.1, top: 0.1, width: 0.8, height: 0.09 }])
  })

  test('renders resolved rectangles only inside a dedicated annotation overlay', () => {
    const { page } = renderedPage(1, 'Selected text')
    const annotation = pdfAnnotation(1, 'Selected text', 0)

    renderPdfAnnotationOverlays({ root: document.body, annotations: [annotation], rects: rects(25, 40, 50, 16) })

    expect(page.querySelectorAll('.pdf-annotation-layer')).toHaveLength(1)
    expect(page.querySelectorAll('.pdf-annotation-layer span')).toHaveLength(1)
    expect(page.querySelector('.textLayer span')?.className).toBe('')
  })

  test('does not paint imported unresolved annotations', () => {
    const { page } = renderedPage(1, 'Selected text')
    const annotation = { ...pdfAnnotation(1, 'Selected text', 0), anchorStatus: 'unresolved' as const }

    renderPdfAnnotationOverlays({ root: document.body, annotations: [annotation], rects: rects(25, 40, 50, 16) })

    expect(page.querySelectorAll('.pdf-annotation-layer span')).toHaveLength(0)
  })

  test('rebuild clears only old annotation rectangles and leaves search marks intact', () => {
    const { page, layer } = renderedPage(1, 'Selected text')
    layer.firstElementChild?.classList.add('pdf-search-match')
    const annotation = pdfAnnotation(1, 'Selected text', 0)

    renderPdfAnnotationOverlays({ root: document.body, annotations: [annotation], rects: rects(10, 20, 40, 15) })
    renderPdfAnnotationOverlays({ root: document.body, annotations: [annotation], rects: rects(20, 30, 50, 15) })

    expect(page.querySelectorAll('.pdf-annotation-layer')).toHaveLength(1)
    expect(page.querySelectorAll('.pdf-annotation-layer span')).toHaveLength(1)
    expect(layer.firstElementChild?.classList.contains('pdf-search-match')).toBe(true)
  })

  test('skips detached text layers without throwing or painting stale overlays', () => {
    const { page, layer } = renderedPage(1, 'Selected text')
    layer.remove()

    expect(() => renderPdfAnnotationOverlays({
      root: document.body,
      annotations: [pdfAnnotation(1, 'Selected text', 0)],
      rects: rects(25, 40, 50, 16),
    })).not.toThrow()
    expect(page.querySelectorAll('.pdf-annotation-layer span')).toHaveLength(0)
  })

  test('clears only annotation overlays', () => {
    const { page, layer } = renderedPage(1, 'Selected text')
    layer.firstElementChild?.classList.add('pdf-search-match')
    const overlay = document.createElement('div')
    overlay.className = 'pdf-annotation-layer'
    page.append(overlay)

    clearPdfAnnotationOverlays(document.body)

    expect(page.querySelector('.pdf-annotation-layer')).toBeNull()
    expect(layer.firstElementChild?.classList.contains('pdf-search-match')).toBe(true)
  })
})

function renderedPage(number: number, ...texts: string[]) {
  const page = document.createElement('section')
  page.className = 'pdf-page'
  page.dataset.page = String(number)
  page.dataset.state = 'rendered'
  Object.defineProperty(page, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 100, height: 200 }) })
  const layer = document.createElement('div')
  layer.className = 'textLayer'
  for (const text of texts) {
    const span = document.createElement('span')
    span.textContent = text
    layer.append(span)
  }
  page.append(layer)
  document.body.append(page)
  return { page, layer }
}

function rects(left: number, top: number, width: number, height: number) {
  return () => [{ left, top, width, height }]
}

function pdfAnnotation(page: number, text: string, textOffset: number): Annotation {
  return {
    id: `annotation-${page}`,
    kind: 'pdf',
    locator: `page:${page}`,
    page,
    section: null,
    text,
    note: '',
    color: '#f4c95d',
    rects: [],
    createdAt: 1,
    anchorStatus: 'resolved',
    anchor: {
      version: 1,
      kind: 'pdf',
      page,
      textOffset,
      quote: { exact: text, normalizedExact: text, prefix: '', suffix: '' },
    },
  }
}
