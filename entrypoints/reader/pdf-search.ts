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

export async function searchRenderedPdf(options: PdfSearchOptions): Promise<PdfSearchOutcome> {
  const query = options.query.trim()
  const maxResults = Math.max(0, options.maxResults ?? 300)
  const yieldControl = options.yieldControl ?? defaultYield
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
            markOverlappingSpans(flattened.spans, match.start, match.end)
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
    for (const layer of touchedLayers) clearPdfSearchMarks(layer)
    throw error
  }

  return { query, total, results, unavailablePages }
}

export function clearPdfSearchMarks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.pdf-search-match').forEach(node => {
    node.classList.remove('pdf-search-match')
  })
}

function flattenTextLayer(layer: HTMLElement): { text: string, spans: TextSpan[] } {
  let text = ''
  const spans: TextSpan[] = []
  for (const element of layer.querySelectorAll<HTMLElement>('span')) {
    const value = element.textContent ?? ''
    const start = text.length
    text += value
    spans.push({ element, start, end: text.length })
  }
  return { text, spans }
}

function markOverlappingSpans(spans: TextSpan[], start: number, end: number): void {
  for (const span of spans) {
    if (span.start < end && span.end > start) span.element.classList.add('pdf-search-match')
  }
}

function defaultYield(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
