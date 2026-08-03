import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  createTextQuoteAnchor,
  normalizeAnchorText,
  resolveTextQuoteAnchor,
} from '../src/core/text-anchor.ts'

test('normalizes whitespace while retaining source offsets', () => {
  const source = 'One\n  two\tthree'
  const value = normalizeAnchorText(source)
  assert.equal(value.text, 'One two three')
  assert.equal(source[value.offsets[4]], 't')
  assert.equal(source[value.offsets[6]], 'o')
})

test('creates a bounded quote around the selected text', () => {
  const source = `${'x'.repeat(80)} selected words ${'y'.repeat(80)}`
  const start = source.indexOf('selected words')
  const anchor = createTextQuoteAnchor(source, start, start + 14, 48)
  assert.equal(anchor.exact, 'selected words')
  assert.equal(anchor.normalizedExact, 'selected words')
  assert.equal(anchor.prefix.length, 48)
  assert.equal(anchor.suffix.length, 48)
})

test('verifies a quote at its preferred source offset', () => {
  const source = 'before selected words after'
  const start = source.indexOf('selected words')
  const anchor = createTextQuoteAnchor(source, start, start + 14)
  assert.deepEqual(resolveTextQuoteAnchor(source, anchor, start), {
    start,
    end: start + 14,
    confidence: 1,
    method: 'offset',
  })
})

test('uses prefix and suffix to resolve repeated text', () => {
  const source = 'alpha target left. beta target right.'
  const start = source.lastIndexOf('target')
  const anchor = createTextQuoteAnchor(source, start, start + 6)
  assert.deepEqual(resolveTextQuoteAnchor(source, anchor, 0), {
    start,
    end: start + 6,
    confidence: 1,
    method: 'quote',
  })
})

test('does not resolve an ambiguous quote without context', () => {
  const anchor = { exact: 'same', normalizedExact: 'same', prefix: '', suffix: '' }
  assert.equal(resolveTextQuoteAnchor('same and same', anchor, null), null)
})

test('returns null for empty or missing text', () => {
  const anchor = { exact: '', normalizedExact: '', prefix: '', suffix: '' }
  assert.equal(resolveTextQuoteAnchor('content', anchor, 0), null)
  assert.equal(resolveTextQuoteAnchor('', { ...anchor, exact: 'word', normalizedExact: 'word' }, 0), null)
})
