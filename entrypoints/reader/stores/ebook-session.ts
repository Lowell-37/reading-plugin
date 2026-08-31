import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { normalizeReaderSettings } from '../../../src/core/migration-preflight'
import type { BookRecord } from '../../../src/core/types'
import type {
  EbookSessionCallbacks,
  EbookSessionError,
  EbookSessionFlow,
  EbookSessionPort,
  EbookSessionPortFactory,
  EbookSessionSnapshot,
  EbookSessionStatus,
  EbookSessionTocItem,
} from '../ebook-session-port'
import type { ReaderSettings } from '../legacy-reader-port'
import { useReaderStore } from './reader'

export type EbookSessionRecord = Pick<BookRecord, 'id' | 'name' | 'format'>

const initialSnapshot = (generation: number, flow: EbookSessionFlow = 'paginated'): EbookSessionSnapshot => ({
  status: 'idle',
  title: '未命名书籍',
  toc: [],
  chapter: '开始',
  progress: 0,
  flow,
  error: null,
  generation,
})

export function createEbookSessionStore(initialPortFactory?: EbookSessionPortFactory) {
  return defineStore('ebook-session', () => {
    const record = shallowRef<EbookSessionRecord | null>(null)
    const status = shallowRef<EbookSessionStatus>('idle')
    const title = shallowRef('未命名书籍')
    const toc = shallowRef<EbookSessionTocItem[]>([])
    const chapter = shallowRef('开始')
    const progress = shallowRef(0)
    const flow = shallowRef<EbookSessionFlow>('paginated')
    const error = shallowRef<EbookSessionError | null>(null)
    const generation = shallowRef(0)
    let port: EbookSessionPort | null = null

    const callbacks: EbookSessionCallbacks = {
      onSnapshot(snapshot) {
        if (snapshot.generation !== generation.value) return
        applySnapshot(snapshot)
      },
      onError(nextError, snapshotGeneration) {
        if (snapshotGeneration !== generation.value) return
        applySnapshot({
          ...initialSnapshot(snapshotGeneration, flow.value),
          status: 'error',
          error: nextError,
        })
      },
    }

    function applySnapshot(snapshot: EbookSessionSnapshot) {
      status.value = snapshot.status
      title.value = snapshot.title
      toc.value = snapshot.toc
      chapter.value = snapshot.chapter
      progress.value = snapshot.progress
      flow.value = snapshot.flow
      error.value = snapshot.error
      useReaderStore().applyEbookSessionSnapshot(snapshot)
    }

    function reset(nextGeneration: number, nextFlow: EbookSessionFlow = 'paginated') {
      record.value = null
      applySnapshot(initialSnapshot(nextGeneration, nextFlow))
    }

    function attachPort(portFactory: EbookSessionPortFactory | null) {
      port?.destroy()
      port = portFactory?.(callbacks) ?? null
    }

    async function open(nextRecord: BookRecord, settings: ReaderSettings) {
      generation.value += 1
      const normalized = normalizeReaderSettings(settings).settings as ReaderSettings
      reset(generation.value, normalized.flow as EbookSessionFlow)
      record.value = { id: nextRecord.id, name: nextRecord.name, format: nextRecord.format }
      status.value = 'loading'
      useReaderStore().applyEbookSessionSnapshot({
        ...initialSnapshot(generation.value, normalized.flow as EbookSessionFlow),
        status: 'loading',
      })
      await port?.open(nextRecord, normalized)
    }

    async function close() {
      generation.value += 1
      await port?.close()
      reset(generation.value)
    }

    async function goTo(target: unknown) {
      await port?.goTo(target)
    }

    async function navigate(direction: -1 | 1) {
      await port?.navigate(direction)
    }

    async function setFlow(nextFlow: EbookSessionFlow) {
      await port?.setFlow(nextFlow)
    }

    async function applySettings(settings: ReaderSettings) {
      await port?.applySettings(normalizeReaderSettings(settings).settings as ReaderSettings)
    }

    async function flushProgress() {
      await port?.flushProgress()
    }

    function destroy() {
      port?.destroy()
      port = null
      generation.value += 1
      reset(generation.value)
    }

    attachPort(initialPortFactory ?? null)

    return {
      record,
      status,
      title,
      toc,
      chapter,
      progress,
      flow,
      error,
      generation,
      attachPort,
      open,
      close,
      goTo,
      navigate,
      setFlow,
      applySettings,
      flushProgress,
      destroy,
    }
  })
}

export const useEbookSessionStore = createEbookSessionStore()
