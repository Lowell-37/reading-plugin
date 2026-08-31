import { createPinia } from 'pinia'
import { describe, expect, test } from 'vitest'
import { type EbookSessionCallbacks, type EbookSessionPort, type EbookSessionPortFactory, type EbookSessionSnapshot } from '../entrypoints/reader/ebook-session-port'
import { createEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import type { BookRecord } from '../src/core/types'

describe('ebook session store', () => {
  test('opens with normalized settings, clears stale reader data, and ignores stale snapshots', async () => {
    const fake = createFakePort()
    const useStore = createEbookSessionStore(fake.factory)
    const store = useStore(createPinia())

    await store.open(record('first.epub'), { flow: 'scrolled', fontSize: 99 })
    fake.emit(snapshot(1, {
      title: 'First title',
      chapter: 'First chapter',
      progress: 0.75,
      flow: 'scrolled',
      toc: [{ label: 'First chapter', href: '/6/2' }],
    }))

    await store.open(record('second.epub'), { flow: 'scrolled', fontSize: 99 })

    expect(fake.opens.at(-1)).toMatchObject({
      record: { id: 'second.epub', name: 'second.epub', format: 'epub' },
      settings: { flow: 'scrolled', fontSize: 20 },
    })
    expect(store.$state).toMatchObject({
      record: { id: 'second.epub', name: 'second.epub', format: 'epub' },
      title: '未命名书籍',
      chapter: '开始',
      progress: 0,
      toc: [],
      flow: 'scrolled',
      generation: 2,
    })

    fake.emit(snapshot(1, { title: 'Stale title', chapter: 'Stale chapter', progress: 0.9 }))

    expect(store.title).toBe('未命名书籍')
    expect(store.chapter).toBe('开始')
    expect(store.progress).toBe(0)
  })

  test('forwards session commands once and projects emitted snapshots into Pinia', async () => {
    const fake = createFakePort()
    const useStore = createEbookSessionStore(fake.factory)
    const store = useStore(createPinia())

    await store.open(record('commands.epub'), {})
    await store.navigate(-1)
    await store.goTo('/6/4')
    await store.setFlow('scrolled')
    fake.emit(snapshot(1, { title: 'Commands', chapter: 'Second chapter', progress: 0.5, flow: 'scrolled' }))
    await store.flushProgress()
    await store.close()

    expect(fake.calls).toEqual(['open', 'navigate:-1', 'goTo:/6/4', 'setFlow:scrolled', 'flushProgress', 'close'])
    expect(store.$state).toMatchObject({
      record: null,
      title: '未命名书籍',
      chapter: '开始',
      progress: 0,
      toc: [],
      status: 'idle',
    })
  })
})

function createFakePort() {
  let callbacks: EbookSessionCallbacks | null = null
  const calls: string[] = []
  const opens: Array<{ record: BookRecord, settings: Record<string, unknown> }> = []
  const port: EbookSessionPort = {
    async open(record, settings) {
      calls.push('open')
      opens.push({ record, settings })
    },
    async close() { calls.push('close') },
    async goTo(target) { calls.push(`goTo:${String(target)}`) },
    async navigate(direction) { calls.push(`navigate:${direction}`) },
    async setFlow(flow) { calls.push(`setFlow:${flow}`) },
    async applySettings() {},
    async flushProgress() { calls.push('flushProgress') },
    destroy() {},
  }

  const factory: EbookSessionPortFactory = nextCallbacks => {
    callbacks = nextCallbacks
    return port
  }

  return {
    calls,
    factory,
    opens,
    emit(next: EbookSessionSnapshot) {
      callbacks?.onSnapshot(next)
    },
  }
}

function record(name: string): BookRecord {
  return {
    id: name,
    name,
    type: 'application/epub+zip',
    size: 4,
    lastModified: 1,
    format: 'epub',
    blob: new Blob(['book']),
    openedAt: 1,
  }
}

function snapshot(generation: number, overrides: Partial<EbookSessionSnapshot> = {}): EbookSessionSnapshot {
  return {
    status: 'ready',
    title: 'Untitled',
    toc: [],
    chapter: '开始',
    progress: 0,
    flow: 'paginated',
    error: null,
    generation,
    ...overrides,
  }
}
