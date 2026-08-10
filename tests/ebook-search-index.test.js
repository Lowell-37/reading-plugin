import assert from 'node:assert/strict'
import { test } from 'vitest'
import { EbookSearchIndex } from '../src/core/ebook-search-index.ts'

const section = (index, text, events = []) => ({
  index,
  label: `Chapter ${index + 1}`,
  async loadText() {
    events.push(`load:${index}`)
    return text
  },
  createLocator(offset, length) {
    return `section:${index}:${offset}:${length}`
  },
})

test('loads every section at most once across repeated queries', async () => {
  const events = []
  const index = new EbookSearchIndex([
    section(0, 'The silver compass points north.', events),
    section(1, 'A brass lantern burns brightly.', events),
  ])

  const first = await index.search('silver')
  const second = await index.search('lantern')

  assert.deepEqual(events, ['load:0', 'load:1'])
  assert.equal(first.results[0].context.text, 'The silver compass points north.')
  assert.equal(first.results[0].locator, 'section:0:4:6')
  assert.equal(second.results[0].section, 1)
})

test('scans cached and current sections first while every emitted snapshot stays in reading order', async () => {
  const events = []
  const index = new EbookSearchIndex([
    section(0, 'needle zero.', events),
    section(1, 'needle one.', events),
    section(2, 'needle two.', events),
  ])
  const warmup = new AbortController()
  await assert.rejects(
    index.search('needle', {
      signal: warmup.signal,
      batchSize: 1,
      onBatch: snapshot => {
        if (snapshot.results.length === 1) warmup.abort()
      },
    }),
    error => error?.name === 'AbortError',
  )
  events.length = 0
  const snapshots = []

  const outcome = await index.search('needle', {
    currentSectionIndex: 2,
    batchSize: 1,
    onBatch: snapshot => snapshots.push(snapshot.results.map(result => result.section)),
  })

  assert.deepEqual(events, ['load:2', 'load:1'])
  assert.deepEqual(snapshots, [[0], [0, 2], [0, 1, 2]])
  assert.deepEqual(outcome.results.map(result => result.section), [0, 1, 2])
})

test('aborting a search prevents batches after the in-flight section resolves', async () => {
  let releaseSecond
  let markSecondStarted
  const secondText = new Promise(resolve => { releaseSecond = resolve })
  const secondStarted = new Promise(resolve => { markSecondStarted = resolve })
  const index = new EbookSearchIndex([
    section(0, 'old result.'),
    {
      index: 1,
      label: 'Chapter 2',
      loadText: () => {
        markSecondStarted()
        return secondText
      },
      createLocator: (offset, length) => `section:1:${offset}:${length}`,
    },
  ])
  const controller = new AbortController()
  const snapshots = []
  const pending = index.search('old', {
    signal: controller.signal,
    batchSize: 1,
    onBatch: snapshot => {
      snapshots.push(snapshot.results.map(result => result.section))
    },
  })
  await secondStarted
  controller.abort()
  releaseSecond('another old result.')

  await assert.rejects(pending, error => error?.name === 'AbortError')
  assert.deepEqual(snapshots, [[0]])
})

test('reports one section failure and continues scanning later sections', async () => {
  const index = new EbookSearchIndex([
    {
      index: 0,
      label: 'Broken chapter',
      loadText: async () => { throw new Error('decode failed') },
      createLocator: () => 'never',
    },
    section(1, 'A recoverable needle appears here.'),
  ])

  const outcome = await index.search('needle')

  assert.deepEqual(outcome.results.map(result => result.section), [1])
  assert.equal(outcome.errors.length, 1)
  assert.equal(outcome.errors[0].section, 0)
  assert.match(outcome.errors[0].error.message, /decode failed/)
})

test('finds every case-insensitive occurrence with original offsets and sentence context', async () => {
  const source = 'Needle first. Between sentences. NEEDLE last!'
  const index = new EbookSearchIndex([section(0, source)])

  const outcome = await index.search('needle')

  assert.deepEqual(outcome.results.map(result => ({
    offset: result.offset,
    length: result.length,
    excerpt: result.context.text,
  })), [
    { offset: 0, length: 6, excerpt: 'Needle first.' },
    { offset: 33, length: 6, excerpt: 'NEEDLE last!' },
  ])
})
