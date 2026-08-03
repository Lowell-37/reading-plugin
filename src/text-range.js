import { createTextQuoteAnchor, resolveTextQuoteAnchor } from './text-anchor.js'

export function rangeTextOffsets(root, range) {
  if (!root || !range || !containsBoundary(root, range.startContainer) || !containsBoundary(root, range.endContainer)) return null
  const document = root.ownerDocument || root
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

export function rangeFromTextOffsets(root, start, end) {
  if (!root || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null
  const nodes = textNodes(root)
  const total = nodes.reduce((length, node) => length + node.data.length, 0)
  if (end > total) return null
  const startPoint = boundaryPoint(nodes, start)
  const endPoint = boundaryPoint(nodes, end)
  if (!startPoint || !endPoint) return null
  const range = (root.ownerDocument || root).createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

export function createRangeAnchor(root, range, contextLength = 48) {
  const offsets = rangeTextOffsets(root, range)
  if (!offsets || offsets.end <= offsets.start) return null
  const source = root.textContent || ''
  const selected = source.slice(offsets.start, offsets.end)
  const leading = selected.match(/^\s*/u)?.[0].length || 0
  const trailing = selected.match(/\s*$/u)?.[0].length || 0
  const start = offsets.start + leading
  const end = Math.max(start, offsets.end - trailing)
  if (end <= start) return null
  return {
    textOffset: start,
    quote: createTextQuoteAnchor(source, start, end, contextLength),
  }
}

export function resolveRangeAnchor(root, quote, preferredOffset = null) {
  if (!root) return null
  const resolution = resolveTextQuoteAnchor(root.textContent || '', quote, preferredOffset)
  if (!resolution) return null
  const range = rangeFromTextOffsets(root, resolution.start, resolution.end)
  if (!range || range.collapsed) return null
  return {
    range,
    textOffset: resolution.start,
    method: resolution.method,
    confidence: resolution.confidence,
  }
}

function containsBoundary(root, node) {
  return root === node || root.contains?.(node)
}

function textNodes(root) {
  const document = root.ownerDocument || root
  const view = document.defaultView
  const walker = document.createTreeWalker(root, view.NodeFilter.SHOW_TEXT)
  const nodes = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node)
    node = walker.nextNode()
  }
  return nodes
}

function boundaryPoint(nodes, target) {
  let offset = 0
  for (const node of nodes) {
    const next = offset + node.data.length
    if (target <= next) return { node, offset: target - offset }
    offset = next
  }
  const last = nodes.at(-1)
  return last && target === offset ? { node: last, offset: last.data.length } : null
}
