import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeEbookPosition } from '../src/ebook-navigation.js'

class FakeView extends EventTarget {
  constructor({ successful }) {
    super()
    this.successful = successful
    this.calls = []
    this.book = { sections: [{ linear: 'no' }, { linear: 'yes' }] }
    this.renderer = { goTo: target => this.navigate('section', target) }
  }

  navigate(kind, target) {
    this.calls.push([kind, target])
    if (this.successful === kind) queueMicrotask(() => this.dispatchEvent(new Event('relocate')))
  }

  goTo(target) { return this.navigate('cfi', target) }
  goToFraction(target) { return this.navigate('fraction', target) }
  goToTextStart() { return this.navigate('text-start') }
}

test('uses a valid saved CFI first', async () => {
  const view = new FakeView({ successful: 'cfi' })
  assert.equal(await initializeEbookPosition(view, { kind: 'ebook', cfi: 'epubcfi(/6/2)', fraction: 0.4 }, { timeout: 5 }), true)
  assert.deepEqual(view.calls, [['cfi', 'epubcfi(/6/2)']])
})

test('falls back from an invalid CFI to the saved fraction', async () => {
  const view = new FakeView({ successful: 'fraction' })
  assert.equal(await initializeEbookPosition(view, { kind: 'ebook', cfi: 'bad-cfi', fraction: 0.4 }, { timeout: 5 }), true)
  assert.deepEqual(view.calls, [['cfi', 'bad-cfi'], ['fraction', 0.4]])
})

test('does not restore a zero fraction into a cover or empty section', async () => {
  const view = new FakeView({ successful: 'text-start' })
  assert.equal(await initializeEbookPosition(view, { kind: 'ebook', cfi: 'bad-cfi', fraction: 0 }, { timeout: 5 }), true)
  assert.deepEqual(view.calls, [['cfi', 'bad-cfi'], ['text-start', undefined]])
})

test('falls back to the first readable section when landmarks fail', async () => {
  const view = new FakeView({ successful: 'section' })
  assert.equal(await initializeEbookPosition(view, null, { timeout: 5 }), true)
  assert.deepEqual(view.calls, [['text-start', undefined], ['section', { index: 1 }]])
})
