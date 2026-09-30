import { createSearchContext, findSearchMatches } from '../../src/core/search-context.js'

export interface PdfSearchResult {
  page: number
  start: number
  end: number
  context: string
}

export interface PdfSearchOutcome {
  query: string
  total: number
  results: PdfSearchResult[]
  unavailablePages: number
}

export interface PdfSearchOptions {
  query: string
  pageCount: number
  readTextLayer(page: number): HTMLElement | null
  signal: AbortSignal
  maxResults?: number
  yieldControl?: () => Promise<void>
}

interface TextSpan {
  element: HTMLElement
  start: number
  end: number
}

let nextSearchOwner = 0

export async function searchRenderedPdf(options: PdfSearchOptions): Promise<PdfSearchOutcome> {
  const query = options.query.trim()
  const maxResults = Math.max(0, options.maxResults ?? 300)
  const yieldControl = options.yieldControl ?? defaultYield
  const owner = `pdf-search-${++nextSearchOwner}`
  const touchedLayers = new Set<HTMLElement>()
  let total = 0
  let unavailablePages = 0
  const results: PdfSearchResult[] = []

  try {
    options.signal.throwIfAborted()
    for (let page = 1; page <= options.pageCount; page += 1) {
      options.signal.throwIfAborted()
      const layer = options.readTextLayer(page)
      if (!layer?.isConnected) {
        unavailablePages += 1
      } else {
        touchedLayers.add(layer)
        clearPdfSearchMarks(layer)
        if (query) {
          const flattened = flattenTextLayer(layer)
          const matches = findSearchMatches(flattened.text, query)
          total += matches.length
          for (const match of matches) {
            markOverlappingSpans(flattened.spans, match.start, match.end, owner)
            if (results.length < maxResults) {
              results.push({
                page,
                start: match.start,
                end: match.end,
                context: createSearchContext(flattened.text, match.start, match.end - match.start).text,
              })
            }
          }
        }
      }
      await yieldControl()
      options.signal.throwIfAborted()
    }
  } catch (error) {
    for (const layer of touchedLayers) clearPdfSearchMarksOwned(layer, owner)
    throw error
  }

  return { query, total, results, unavailablePages }
}

export function clearPdfSearchMarks(root: ParentNode): void {
  clearPdfSearchMarksOwned(root)
}

function clearPdfSearchMarksOwned(root: ParentNode, owner?: string): void {
  const layers = root instanceof HTMLElement && root.classList.contains('textLayer')
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>('.textLayer'))

  for (const layer of layers) {
    for (const span of layer.querySelectorAll<HTMLElement>('span.pdf-search-match')) {
      if (span.closest('.pdf-annotation-layer')) continue
      if (owner && span.dataset.pdfSearchOwner !== owner) continue
      span.classList.remove('pdf-search-match')
      delete span.dataset.pdfSearchOwner
    }
  }
}

function flattenTextLayer(layer: HTMLElement): { text: string, spans: TextSpan[] } {
  let text = ''
  const spans: TextSpan[] = []
  for (const element of layer.querySelectorAll<HTMLElement>('span')) {
    if (element.closest('.pdf-annotation-layer')) continue
    const value = element.textContent ?? ''
    const start = text.length
    text += value
    spans.push({ element, start, end: text.length })
  }
  return { text, spans }
}

function markOverlappingSpans(spans: TextSpan[], start: number, end: number, owner: string): void {
  for (const span of spans) {
    if (span.start < end && span.end > start) {
      span.element.classList.add('pdf-search-match')
      span.element.dataset.pdfSearchOwner = owner
    }
  }
}

function defaultYield(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
