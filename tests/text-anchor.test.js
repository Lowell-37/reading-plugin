import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  createTextQuoteAnchor,
  normalizeAnchorText,
  resolveChangedTextQuoteAnchor,
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

test('scores frequent short quotes without slicing unbounded chapter context', () => {
  const source = 'a '.repeat(2_000)
  const anchor = { exact: 'a', normalizedExact: 'a', prefix: 'missing', suffix: 'context' }
  const originalSlice = String.prototype.slice
  String.prototype.slice = function boundedSlice(start, end) {
    const result = originalSlice.call(this, start, end)
    if (String(this).length > 1_000 && result.length > 128) {
      throw new Error('resolver sliced unbounded chapter context')
    }
    return result
  }
  try {
    assert.equal(resolveTextQuoteAnchor(source, anchor, null), null)
  } finally {
    String.prototype.slice = originalSlice
  }
})


test('fuzzily resolves a quote after a small word insertion', () => {
  const oldSource = 'Before. The silver compass pointed north at dawn. After.'
  const phrase = 'The silver compass pointed north at dawn'
  const start = oldSource.indexOf(phrase)
  const anchor = createTextQuoteAnchor(oldSource, start, start + phrase.length)
  const changed = 'Before. The old silver compass pointed north at dawn. After.'
  const changedStart = changed.indexOf('The old silver compass')
  const result = resolveChangedTextQuoteAnchor(changed, anchor, start)
  assert.equal(result?.method, 'fuzzy')
  assert.equal(changed.slice(result.start, result.end), 'The old silver compass pointed north at dawn')
  assert.ok(result.confidence >= 0.86)
})

test('fuzzily resolves a quote after a small deletion and nearby move', () => {
  const oldSource = 'Opening context. The bright silver compass pointed north at dawn. Closing context.'
  const phrase = 'The bright silver compass pointed north at dawn'
  const start = oldSource.indexOf(phrase)
  const anchor = createTextQuoteAnchor(oldSource, start, start + phrase.length)
  const changed = 'New preface. Opening context. The silver compass pointed north at dawn. Closing context.'
  const result = resolveChangedTextQuoteAnchor(changed, anchor, start)
  assert.equal(result?.method, 'fuzzy')
  assert.match(changed.slice(result.start, result.end), /silver compass pointed north at dawn/)
})

test('rejects tied fuzzy candidates', () => {
  const anchor = {
    exact: 'silver compass pointed north',
    normalizedExact: 'silver compass pointed north',
    prefix: '',
    suffix: '',
  }
  const source = 'old silver compass pointed north. Gap. old silver compass pointed north.'
  assert.equal(resolveChangedTextQuoteAnchor(source, anchor, null), null)
})

test('rejects a fuzzy candidate below the confidence threshold', () => {
  const anchor = {
    exact: 'silver compass pointed north',
    normalizedExact: 'silver compass pointed north',
    prefix: 'before ',
    suffix: ' after',
  }
  assert.equal(resolveChangedTextQuoteAnchor('before unrelated lantern story after', anchor, 7), null)
})

test('rejects a fuzzy winner without the required lead', () => {
  const exact = 'abcdefghijabcdefghijabcdefghij'
  const anchor = { exact, normalizedExact: exact, prefix: '', suffix: '' }
  const source = 'abcxefghijabcdefghijabcdefghij -- abcxefghijabcdefyhijabcdefghij'
  assert.equal(resolveChangedTextQuoteAnchor(source, anchor, null, {
    minimumConfidence: 0.8,
    minimumLead: 0.08,
  }), null)
})
