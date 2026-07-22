import test from 'node:test'
import assert from 'node:assert/strict'
import { SectionBoundaryNavigator } from '../src/section-navigation.js'

test('does not change sections while the current section can still scroll', () => {
  const navigator = new SectionBoundaryNavigator({ threshold: 60 })
  assert.equal(navigator.push({ delta: 120, atStart: false, atEnd: false, now: 100 }), 0)
})

test('accumulates trackpad deltas and advances at the chapter end', () => {
  const navigator = new SectionBoundaryNavigator({ threshold: 60 })
  assert.equal(navigator.push({ delta: 25, atStart: false, atEnd: true, now: 100 }), 0)
  assert.equal(navigator.push({ delta: 40, atStart: false, atEnd: true, now: 180 }), 1)
})

test('moves backward at the chapter start', () => {
  const navigator = new SectionBoundaryNavigator({ threshold: 60 })
  assert.equal(navigator.push({ delta: -80, atStart: true, atEnd: false, now: 100 }), -1)
})

test('cooldown prevents inertial scrolling from skipping chapters', () => {
  const navigator = new SectionBoundaryNavigator({ threshold: 60, cooldown: 650 })
  assert.equal(navigator.push({ delta: 80, atStart: false, atEnd: true, now: 100 }), 1)
  assert.equal(navigator.push({ delta: 100, atStart: false, atEnd: true, now: 200 }), 0)
  assert.equal(navigator.push({ delta: 100, atStart: false, atEnd: true, now: 800 }), 1)
})

test('changing wheel direction resets accumulated movement', () => {
  const navigator = new SectionBoundaryNavigator({ threshold: 60 })
  assert.equal(navigator.push({ delta: 40, atStart: false, atEnd: true, now: 100 }), 0)
  assert.equal(navigator.push({ delta: -30, atStart: true, atEnd: false, now: 150 }), 0)
  assert.equal(navigator.push({ delta: -35, atStart: true, atEnd: false, now: 200 }), -1)
})
