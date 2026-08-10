import { test } from 'vitest'
import assert from 'node:assert/strict'

import {
  activeSectionIndex,
  interpolateSectionProgress,
  retainedSectionIndices,
} from '../src/continuous-layout.js'

test('maps a local chapter position into whole-book progress', () => {
  const starts = [0, .1, .35, .8]
  assert.equal(interpolateSectionProgress(starts, 1, 0), .1)
  assert.ok(Math.abs(interpolateSectionProgress(starts, 1, .5) - .225) < Number.EPSILON)
  assert.equal(interpolateSectionProgress(starts, 1, 1), .35)
  assert.equal(interpolateSectionProgress(starts, 3, 1), 1)
})

test('clamps invalid local progress values', () => {
  assert.equal(interpolateSectionProgress([0, .5], 0, -2), 0)
  assert.equal(interpolateSectionProgress([0, .5], 1, 8), 1)
})

test('finds the chapter occupying the middle of the viewport', () => {
  const layout = [
    { index: 4, top: 0, bottom: 700 },
    { index: 5, top: 700, bottom: 1500 },
    { index: 6, top: 1500, bottom: 2300 },
  ]
  assert.equal(activeSectionIndex(layout, 690), 4)
  assert.equal(activeSectionIndex(layout, 940), 5)
  assert.equal(activeSectionIndex(layout, 1900), 6)
})

test('uses the nearest section outside the rendered bounds', () => {
  const layout = [
    { index: 2, top: 300, bottom: 900 },
    { index: 3, top: 900, bottom: 1500 },
  ]
  assert.equal(activeSectionIndex(layout, 0), 2)
  assert.equal(activeSectionIndex(layout, 1800), 3)
  assert.equal(activeSectionIndex([], 400), -1)
})

test('keeps a bounded section window around the active chapter', () => {
  const indices = [1, 2, 4, 5, 8, 9, 12, 15]
  assert.deepEqual([...retainedSectionIndices(indices, 8, 2)], [4, 5, 8, 9, 12])
  assert.deepEqual([...retainedSectionIndices(indices, 1, 3)], [1, 2, 4, 5])
  assert.deepEqual([...retainedSectionIndices(indices, 99, 3)], [])
})
