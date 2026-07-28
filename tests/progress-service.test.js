import { test } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeProgress, ProgressService } from '../src/progress-service.js'

test('normalizes ebook and PDF locations without changing the persisted shape', () => {
  assert.deepEqual(normalizeProgress({ kind: 'ebook', cfi: 'epubcfi(/6/2)', fraction: 1.5 }), {
    kind: 'ebook', cfi: 'epubcfi(/6/2)', fraction: 1,
  })
  assert.deepEqual(normalizeProgress({ kind: 'pdf', page: 2.6, fraction: -1 }), {
    kind: 'pdf', page: 3, fraction: 0,
  })
  assert.equal(normalizeProgress({ kind: 'unknown' }), null)
})

test('coalesces pending progress and can flush it immediately', async () => {
  const writes = []
  const service = new ProgressService({
    update: async (id, changes) => writes.push({ id, changes }),
  }, { delay: 10_000, now: () => 123 })

  service.schedule('book-1', { kind: 'pdf', page: 2, fraction: .1 })
  service.schedule('book-1', { kind: 'pdf', page: 4, fraction: .3 })
  assert.equal(await service.flush(), true)
  assert.deepEqual(writes, [{
    id: 'book-1',
    changes: { progress: { kind: 'pdf', page: 4, fraction: .3 }, openedAt: 123 },
  }])
  assert.equal(await service.flush(), false)
})

test('cancel discards a pending write', async () => {
  const writes = []
  const service = new ProgressService({ update: async (...args) => writes.push(args) }, { delay: 10_000 })
  service.schedule('book-1', { kind: 'ebook', fraction: .5 })
  service.cancel()
  assert.equal(await service.flush(), false)
  assert.deepEqual(writes, [])
})
