import assert from 'node:assert/strict'
import { test } from 'vitest'
import { recoverTextAnchor } from '../src/core/anchor-recovery.ts'
import { createTextQuoteAnchor } from '../src/core/text-anchor.ts'

function savedAnchor(source, phrase) {
  const start = source.indexOf(phrase)
  return createTextQuoteAnchor(source, start, start + phrase.length)
}

test('prefers an exact match in the original location', () => {
  const phrase = 'the silver compass pointed north'
  const source = `Before ${phrase} after.`
  const result = recoverTextAnchor(savedAnchor(source, phrase), [
    { location: 4, text: source, preferredOffset: source.indexOf(phrase) },
    { location: 5, text: `Also ${phrase} here.`, preferredOffset: null },
  ])
  assert.equal(result?.location, 4)
  assert.equal(result?.method, 'offset')
})

test('recovers a changed quote in an adjacent location and rebuilds its quote', () => {
  const phrase = 'the silver compass pointed north at dawn'
  const oldSource = `Before ${phrase}. After.`
  const changed = 'New chapter. Before the old silver compass pointed north at dawn. After.'
  const result = recoverTextAnchor(savedAnchor(oldSource, phrase), [
    { location: 4, text: 'This section no longer contains the passage.', preferredOffset: oldSource.indexOf(phrase) },
    { location: 5, text: changed, preferredOffset: null },
  ])
  assert.equal(result?.location, 5)
  assert.equal(result?.method, 'fuzzy')
  assert.equal(changed.slice(result.start, result.end), result.quote.exact)
  assert.match(result.quote.exact, /old silver compass/)
})

test('rejects equally strong matches in different nearby locations', () => {
  const phrase = 'the silver compass pointed north'
  const anchor = savedAnchor(`Before ${phrase}. After.`, phrase)
  const duplicate = 'Before the old silver compass pointed north. After.'
  assert.equal(recoverTextAnchor(anchor, [
    { location: 3, text: 'Missing.', preferredOffset: null },
    { location: 2, text: duplicate, preferredOffset: null },
    { location: 4, text: duplicate, preferredOffset: null },
  ]), null)
})

test('does not mutate anchors or candidates when recovery is rejected', () => {
  const anchor = {
    exact: 'a unique original passage',
    normalizedExact: 'a unique original passage',
    prefix: 'before ',
    suffix: ' after',
  }
  const candidates = [{ location: 1, text: 'unrelated text', preferredOffset: 0 }]
  const snapshot = structuredClone({ anchor, candidates })
  assert.equal(recoverTextAnchor(anchor, candidates), null)
  assert.deepEqual({ anchor, candidates }, snapshot)
})
