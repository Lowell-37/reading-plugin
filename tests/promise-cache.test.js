import assert from 'node:assert/strict'
import { test } from 'vitest'
import { PromiseCache } from '../src/core/promise-cache.ts'

test('shares one pending load across concurrent callers', async () => {
  let calls = 0
  let release
  const pendingValue = new Promise(resolve => { release = resolve })
  const cache = new PromiseCache()
  const loader = () => {
    calls += 1
    return pendingValue
  }

  const first = cache.get(1, loader)
  const second = cache.get(1, loader)
  release('page text')

  assert.equal(await first, 'page text')
  assert.equal(await second, 'page text')
  assert.equal(calls, 1)
})

test('removes a rejected load so a later call can retry', async () => {
  let calls = 0
  const cache = new PromiseCache()
  await assert.rejects(cache.get(1, async () => {
    calls += 1
    throw new Error('temporary failure')
  }))

  assert.equal(await cache.get(1, async () => {
    calls += 1
    return 'recovered'
  }), 'recovered')
  assert.equal(calls, 2)
})
