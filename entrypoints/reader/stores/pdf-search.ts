import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import {
  clearPdfSearchMarks,
  searchRenderedPdf,
  type PdfSearchOptions,
  type PdfSearchOutcome,
  type PdfSearchResult,
} from '../pdf-search'
import type { PdfSessionStatus } from '../pdf-session-port'
import { usePdfSessionStore } from './pdf-session'

export type PdfSearchStatus = 'idle' | 'searching' | 'ready' | 'error'
export type PdfSearchRunner = (options: PdfSearchOptions) => Promise<PdfSearchOutcome>

export interface PdfSearchSessionIdentity {
  generation: number
  status: PdfSessionStatus
  zoom: number
  recordId: string | null
}

export function createPdfSearchStore(search: PdfSearchRunner = searchRenderedPdf) {
  return defineStore('pdf-search', () => {
    const query = shallowRef('')
    const status = shallowRef<PdfSearchStatus>('idle')
    const results = shallowRef<PdfSearchResult[]>([])
    const total = shallowRef(0)
    const unavailablePages = shallowRef(0)
    const error = shallowRef<string | null>(null)
    const pdf = usePdfSessionStore()
    let root: ParentNode | null = null
    let controller: AbortController | null = null
    let requestId = 0
    let sessionIdentity: PdfSearchSessionIdentity | null = null

    function attachRoot(nextRoot: ParentNode | null) {
      if (root !== nextRoot) clear()
      root = nextRoot
    }

    async function run(value: string) {
      const normalized = value.trim()
      if (!normalized) {
        clear()
        return
      }

      controller?.abort()
      const currentController = new AbortController()
      controller = currentController
      const currentRequest = ++requestId
      const generation = pdf.generation
      const recordId = pdf.record?.id ?? null
      if (root) clearPdfSearchMarks(root)
      query.value = normalized
      status.value = 'searching'
      results.value = []
      total.value = 0
      unavailablePages.value = 0
      error.value = null

      try {
        const outcome = await search({
          query: normalized,
          pageCount: pdf.pageCount,
          readTextLayer: page => pdf.readRenderedTextLayer(page),
          signal: currentController.signal,
        })
        if (!isCurrent(currentRequest, currentController, generation, recordId)) return
        query.value = outcome.query
        results.value = outcome.results.map(result => ({ ...result }))
        total.value = outcome.total
        unavailablePages.value = outcome.unavailablePages
        status.value = 'ready'
      } catch (cause) {
        if (isAbort(cause) || !isCurrent(currentRequest, currentController, generation, recordId)) return
        if (root) clearPdfSearchMarks(root)
        results.value = []
        total.value = 0
        unavailablePages.value = 0
        error.value = '搜索失败，请换一个关键词重试'
        status.value = 'error'
      } finally {
        if (controller === currentController) controller = null
      }
    }

    async function goToResult(result: PdfSearchResult) {
      await pdf.goTo(result.page)
    }

    function synchronizeSession(next: PdfSearchSessionIdentity) {
      const changed = sessionIdentity !== null
        && (sessionIdentity.generation !== next.generation
          || sessionIdentity.status !== next.status
          || sessionIdentity.zoom !== next.zoom
          || sessionIdentity.recordId !== next.recordId)
      sessionIdentity = { ...next }
      if (changed || next.status !== 'ready') clear()
    }

    function clear() {
      controller?.abort()
      controller = null
      requestId += 1
      if (root) clearPdfSearchMarks(root)
      query.value = ''
      status.value = 'idle'
      results.value = []
      total.value = 0
      unavailablePages.value = 0
      error.value = null
    }

    function isCurrent(
      candidateRequest: number,
      candidateController: AbortController,
      generation: number,
      recordId: string | null,
    ) {
      return requestId === candidateRequest
        && controller === candidateController
        && !candidateController.signal.aborted
        && pdf.generation === generation
        && pdf.record?.id === recordId
        && pdf.status === 'ready'
    }

    return {
      query,
      status,
      results,
      total,
      unavailablePages,
      error,
      attachRoot,
      run,
      goToResult,
      synchronizeSession,
      clear,
    }
  })
}

export const usePdfSearchStore = createPdfSearchStore()

function isAbort(cause: unknown) {
  return cause instanceof DOMException
    ? cause.name === 'AbortError'
    : typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError'
}
