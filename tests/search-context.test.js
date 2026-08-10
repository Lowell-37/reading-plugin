import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createSearchContext, findSearchMatches } from '../src/core/search-context.ts'

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

test('maps case-folded matches back to original UTF-16 offsets', () => {
  const source = 'İNeedle follows the expanding capital.'
  assert.deepEqual(findSearchMatches(source, 'needle'), [{ start: 1, end: 7 }])
})

test('maps a match inside an expanding case-folded character to the whole original character', () => {
  assert.deepEqual(findSearchMatches('İstanbul', 'i'), [{ start: 0, end: 1 }])
})

test('uses whole-string casing context for Greek final sigma', () => {
  assert.deepEqual(findSearchMatches('ΟΣ', 'ος'), [{ start: 0, end: 2 }])
})

test('stops context at punctuation included in the match', () => {
  const source = 'One sentence. Next sentence.'
  assert.equal(createSearchContext(source, 0, 'One sentence.'.length).text, 'One sentence.')
})
