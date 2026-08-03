import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createSearchContext } from '../src/core/search-context.ts'

test('returns the complete English sentence containing the match', () => {
  const source = 'First sentence. The silver compass points north! Final sentence.'
  const start = source.indexOf('silver')
  assert.deepEqual(createSearchContext(source, start, 6), {
    text: 'The silver compass points north!',
    start: 16,
    end: 48,
    matchStart: 4,
    matchEnd: 10,
  })
})

test('recognizes Chinese sentence punctuation', () => {
  const source = '第一句。银色罗盘指向北方！最后一句。'
  const start = source.indexOf('罗盘')
  assert.equal(createSearchContext(source, start, 2).text, '银色罗盘指向北方！')
})

test('collapses whitespace while preserving mapped match offsets', () => {
  const source = 'Intro.  A\n  silver\tcompass works.  End.'
  const start = source.indexOf('silver')
  const result = createSearchContext(source, start, 6)
  assert.equal(result.text, 'A silver compass works.')
  assert.equal(result.text.slice(result.matchStart, result.matchEnd), 'silver')
  assert.equal(source.slice(result.start, result.end).trim(), 'A\n  silver\tcompass works.')
})

test('falls back to a bounded window when there is no sentence boundary', () => {
  const source = '0123456789abcdefghijABCDEFGHIJ'
  const start = source.indexOf('fgh')
  const result = createSearchContext(source, start, 3, 5)
  assert.equal(result.text, 'abcdefghijABC')
  assert.ok(result.start >= start - 5)
  assert.ok(result.end <= start + 3 + 5)
})
