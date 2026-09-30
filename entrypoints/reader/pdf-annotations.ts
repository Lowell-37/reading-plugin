import { createAnnotation } from '../../src/core/annotations'
import type { Annotation, AnnotationRect, TextQuoteAnchor } from '../../src/core/types'
import { createTextQuoteAnchor, resolveTextQuoteAnchor } from '../../src/core/text-anchor'

export interface PdfAnnotationClientRect {
  left: number
  top: number
  width: number
  height: number
}

export type PdfAnnotationRectReader = (range: Range) => Iterable<PdfAnnotationClientRect>

export interface CreatePdfAnnotationFromRangeOptions {
  page: HTMLElement
  range: Range
  note?: string
  color?: string
  tags?: string[]
  rects?: PdfAnnotationRectReader
}

export interface RenderPdfAnnotationOverlaysOptions {
  root: ParentNode
  annotations: Annotation[]
  page?: number
  rects?: PdfAnnotationRectReader
  onResolved?: (annotation: Annotation, resolved: { textOffset: number, rects: AnnotationRect[] }) => void
  onClick?: (annotation: Annotation) => void
}

export function createPdfAnnotationFromRange({
  page,
  range,
  note = '',
  color,
  tags,
  rects = readRangeRects,
}: CreatePdfAnnotationFromRangeOptions): Annotation | null {
  const textLayer = renderedTextLayer(page)
  const pageNumber = pageNumberOf(page)
  if (!textLayer || pageNumber == null || range.collapsed || !containsRange(textLayer, range)) return null

  const anchor = createRangeAnchor(textLayer, range)
  const text = range.toString().trim()
  const measured = relativeRects(page, range, rects)
  if (!anchor || !text || !measured.length) return null

  return createAnnotation({
    kind: 'pdf',
    page: pageNumber,
    locator: `page:${pageNumber}`,
    text,
    note,
    color,
    tags,
    rects: measured,
    anchor: {
      version: 1,
      kind: 'pdf',
      page: pageNumber,
      textOffset: anchor.textOffset,
      quote: anchor.quote,
    },
    anchorStatus: 'resolved',
  })
}

export function renderPdfAnnotationOverlays({
  root,
  annotations,
  page: requestedPage,
  rects = readRangeRects,
  onResolved,
  onClick,
}: RenderPdfAnnotationOverlaysOptions): void {
  const pages = requestedPage == null
    ? Array.from(root.querySelectorAll<HTMLElement>('.pdf-page'))
    : Array.from(root.querySelectorAll<HTMLElement>(`.pdf-page[data-page="${requestedPage}"]`))

  for (const page of pages) {
    clearPdfAnnotationOverlays(page)
    const pageNumber = pageNumberOf(page)
    const textLayer = renderedTextLayer(page)
    if (pageNumber == null || !textLayer) continue

    const layer = document.createElement('div')
    layer.className = 'pdf-annotation-layer'
    for (const annotation of annotations) {
      if (annotation.kind !== 'pdf' || annotation.page !== pageNumber || annotation.anchorStatus === 'unresolved') continue
      const measured = resolveAnnotationRects(page, textLayer, annotation, rects)
      if (!measured) continue
      if (annotation.anchor?.kind === 'pdf') onResolved?.(annotation, measured)
      for (const rect of measured.rects) {
        const mark = document.createElement('span')
        mark.dataset.annotationId = annotation.id
        mark.style.left = `${rect.left * 100}%`
        mark.style.top = `${rect.top * 100}%`
        mark.style.width = `${rect.width * 100}%`
        mark.style.height = `${rect.height * 100}%`
        mark.title = annotation.note || annotation.text
        if (onClick) mark.addEventListener('click', () => onClick(annotation))
        layer.append(mark)
      }
    }
    if (layer.childElementCount) page.append(layer)
  }
}

export function clearPdfAnnotationOverlays(root: ParentNode): void {
  root.querySelectorAll('.pdf-annotation-layer').forEach(layer => layer.remove())
}

function resolveAnnotationRects(
  page: HTMLElement,
  textLayer: HTMLElement,
  annotation: Annotation,
  rects: PdfAnnotationRectReader,
): { textOffset: number, rects: AnnotationRect[] } | null {
  if (annotation.anchor?.kind !== 'pdf') {
    return annotation.rects.length ? { textOffset: 0, rects: annotation.rects } : null
  }
  const resolved = resolveRangeAnchor(textLayer, annotation.anchor.quote, annotation.anchor.textOffset)
  if (!resolved) return null
  const measured = relativeRects(page, resolved.range, rects)
  return measured.length ? { textOffset: resolved.textOffset, rects: measured } : null
}

function renderedTextLayer(page: HTMLElement): HTMLElement | null {
  if (!page.isConnected || page.dataset.state !== 'rendered') return null
  const textLayer = page.querySelector<HTMLElement>('.textLayer')
  return textLayer?.isConnected ? textLayer : null
}

function pageNumberOf(page: HTMLElement): number | null {
  const value = Number(page.dataset.page)
  return Number.isInteger(value) && value >= 1 ? value : null
}

function containsRange(root: HTMLElement, range: Range): boolean {
  return root.contains(range.startContainer) && root.contains(range.endContainer)
}

function createRangeAnchor(root: HTMLElement, range: Range) {
  const offsets = rangeTextOffsets(root, range)
  if (!offsets || offsets.end <= offsets.start) return null
  const source = root.textContent || ''
  const selected = source.slice(offsets.start, offsets.end)
  const leading = selected.match(/^\s*/u)?.[0].length || 0
  const trailing = selected.match(/\s*$/u)?.[0].length || 0
  const start = offsets.start + leading
  const end = Math.max(start, offsets.end - trailing)
  if (end <= start) return null
  return { textOffset: start, quote: createTextQuoteAnchor(source, start, end) }
}

function resolveRangeAnchor(root: HTMLElement, quote: TextQuoteAnchor, preferredOffset: number | null) {
  const resolution = resolveTextQuoteAnchor(root.textContent || '', quote, preferredOffset)
  if (!resolution) return null
  const range = rangeFromTextOffsets(root, resolution.start, resolution.end)
  return range && !range.collapsed ? { range, textOffset: resolution.start } : null
}

function rangeTextOffsets(root: HTMLElement, range: Range): { start: number, end: number } | null {
  if (!containsRange(root, range)) return null
  const document = root.ownerDocument
  const startProbe = document.createRange()
  const endProbe = document.createRange()
  try {
    startProbe.selectNodeContents(root)
    startProbe.setEnd(range.startContainer, range.startOffset)
    endProbe.selectNodeContents(root)
    endProbe.setEnd(range.endContainer, range.endOffset)
    return { start: startProbe.toString().length, end: endProbe.toString().length }
  } catch {
    return null
  }
}

function rangeFromTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null
  const nodes = textNodes(root)
  const total = nodes.reduce((length, node) => length + node.data.length, 0)
  if (end > total) return null
  const startPoint = boundaryPoint(nodes, start)
  const endPoint = boundaryPoint(nodes, end)
  if (!startPoint || !endPoint) return null
  const range = root.ownerDocument.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

function textNodes(root: HTMLElement): Text[] {
  const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4
  const walker = root.ownerDocument.createTreeWalker(root, showText)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes
}

function boundaryPoint(nodes: Text[], target: number): { node: Text, offset: number } | null {
  let offset = 0
  for (const node of nodes) {
    const next = offset + node.data.length
    if (target <= next) return { node, offset: target - offset }
    offset = next
  }
  const last = nodes.at(-1)
  return last && target === offset ? { node: last, offset: last.data.length } : null
}

function relativeRects(page: HTMLElement, range: Range, readRects: PdfAnnotationRectReader): AnnotationRect[] {
  const bounds = page.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return []
  try {
    return Array.from(readRects(range))
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => ({
        left: (rect.left - bounds.left) / bounds.width,
        top: (rect.top - bounds.top) / bounds.height,
        width: rect.width / bounds.width,
        height: rect.height / bounds.height,
      }))
  } catch {
    return []
  }
}

function readRangeRects(range: Range): Iterable<PdfAnnotationClientRect> {
  return range.getClientRects()
}
