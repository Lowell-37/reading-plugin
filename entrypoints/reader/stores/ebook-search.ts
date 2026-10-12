import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { EbookSearchResult, EbookSearchSnapshot } from '../../../src/core/ebook-search-index'
import type { EbookSessionStatus } from '../ebook-session-port'
import { useEbookSessionStore } from './ebook-session'

export type EbookSearchStatus = 'idle' | 'searching' | 'ready' | 'error'

export interface EbookSearchSessionIdentity {
  generation: number
  status: EbookSessionStatus
  recordId: string | null
}

export function createEbookSearchStore() {
  return defineStore('ebook-search', () => {
    const ebook = useEbookSessionStore()
    const query = shallowRef('')
    const status = shallowRef<EbookSearchStatus>('idle')
    const results = shallowRef<EbookSearchResult[]>([])
    const total = shallowRef(0)
    const failedSections = shallowRef(0)
    const error = shallowRef<string | null>(null)
    let controller: AbortController | null = null
    let requestId = 0
    let sessionIdentity: EbookSearchSessionIdentity | null = null

    function publish(snapshot: EbookSearchSnapshot) {
      results.value = snapshot.results.slice(0, 300)
      total.value = snapshot.total
      failedSections.value = snapshot.errors.length
    }

    async function run(value: string) {
      const normalized = value.trim()
      if (!normalized) { clear(); return }
      controller?.abort()
      const currentController = new AbortController()
      controller = currentController
      const currentRequest = ++requestId
      const generation = ebook.generation
      const recordId = ebook.record?.id ?? null
      query.value = normalized
      status.value = 'searching'
      results.value = []
      total.value = 0
      failedSections.value = 0
      error.value = null
      try {
        const outcome = await ebook.search(normalized, {
          signal: currentController.signal,
          batchSize: 20,
          maxResults: 300,
          onBatch: batch => {
            if (isCurrent(currentRequest, currentController, generation, recordId)) publish(batch)
          },
        })
        if (!isCurrent(currentRequest, currentController, generation, recordId)) return
        publish(outcome)
        status.value = 'ready'
      } catch (cause) {
        if (isAbort(cause) || !isCurrent(currentRequest, currentController, generation, recordId)) return
        results.value = []
        total.value = 0
        failedSections.value = 0
        error.value = '搜索失败，请换一个关键词重试'
        status.value = 'error'
      } finally {
        if (controller === currentController) controller = null
      }
    }

    async function goToResult(result: EbookSearchResult) {
      await ebook.goTo(result.locator)
    }

    function synchronizeSession(next: EbookSearchSessionIdentity) {
      const changed = sessionIdentity !== null
        && (sessionIdentity.generation !== next.generation
          || sessionIdentity.status !== next.status
          || sessionIdentity.recordId !== next.recordId)
      sessionIdentity = { ...next }
      if (changed || next.status !== 'ready') clear()
    }

    function clear() {
      controller?.abort()
      controller = null
      requestId += 1
      query.value = ''
      status.value = 'idle'
      results.value = []
      total.value = 0
      failedSections.value = 0
      error.value = null
    }

    function isCurrent(candidateRequest: number, candidateController: AbortController, generation: number, recordId: string | null) {
      return requestId === candidateRequest && controller === candidateController
        && !candidateController.signal.aborted && ebook.generation === generation
        && ebook.record?.id === recordId && ebook.status === 'ready'
    }

    return { query, status, results, total, failedSections, error, run, goToResult, synchronizeSession, clear }
  })
}

export const useEbookSearchStore = createEbookSearchStore()

function isAbort(cause: unknown) {
  return typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError'
}
