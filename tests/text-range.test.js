import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { test } from 'vitest'
import {
  createRangeAnchor,
  rangeFromTextOffsets,
  rangeTextOffsets,
  resolveRangeAnchor,
} from '../src/text-range.js'

test('maps a range across inline elements to document text offsets', () => {
  const dom = new JSDOM('<body>one <em>two</em> three</body>')
  const root = dom.window.document.body
  const range = dom.window.document.createRange()
  range.setStart(root.firstChild, 2)
  range.setEnd(root.querySelector('em').firstChild, 2)
  assert.deepEqual(rangeTextOffsets(root, range), { start: 2, end: 6 })
  assert.equal(rangeFromTextOffsets(root, 2, 6).toString(), 'e tw')
})

test('creates a quote and source offset from a DOM range', () => {
  const dom = new JSDOM('<body>before <b>selected words</b> after</body>')
  const root = dom.window.document.body
  const range = dom.window.document.createRange()
  range.selectNodeContents(root.querySelector('b'))
  const saved = createRangeAnchor(root, range)
  assert.equal(saved.textOffset, 7)
  assert.equal(saved.quote.exact, 'selected words')
  assert.equal(saved.quote.prefix, 'before ')
  assert.equal(saved.quote.suffix, ' after')
})

test('rebuilds the selected range after inline markup changes', () => {
  const firstDom = new JSDOM('<body>before <b>selected words</b> after</body>')
  const first = firstDom.window.document.body
  const sourceRange = first.ownerDocument.createRange()
  sourceRange.selectNodeContents(first.querySelector('b'))
  const saved = createRangeAnchor(first, sourceRange)

  const second = new JSDOM('<body><span>before</span> selected <i>words</i> after</body>').window.document.body
  const resolved = resolveRangeAnchor(second, saved.quote, saved.textOffset)
  assert.equal(resolved.range.toString(), 'selected words')
  assert.equal(resolved.textOffset, 7)
})

test('returns null when the quote cannot be resolved uniquely', () => {
  const root = new JSDOM('<body>same and same</body>').window.document.body
  const quote = { exact: 'same', normalizedExact: 'same', prefix: '', suffix: '' }
  assert.equal(resolveRangeAnchor(root, quote, null), null)
})

test('rejects a range outside the supplied root', () => {
  const dom = new JSDOM('<body><main>inside</main><aside>outside</aside></body>')
  const range = dom.window.document.createRange()
  range.selectNodeContents(dom.window.document.querySelector('aside'))
  assert.equal(rangeTextOffsets(dom.window.document.querySelector('main'), range), null)
})
