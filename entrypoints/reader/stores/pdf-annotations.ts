import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { filterAnnotations, sortAnnotations, updateAnnotation } from '../../../src/core/annotations'
import type { Annotation, BookRecord } from '../../../src/core/types'
import {
  clearPdfAnnotationOverlays,
  createPdfAnnotationFromRange,
  renderPdfAnnotationOverlays,
  type CreatePdfAnnotationFromRangeOptions,
} from '../pdf-annotations'

type Repository = { update(id: string, changes: Pick<BookRecord, 'annotations'>): Promise<void> }
type Session = { record: BookRecord | null, generation: number, zoom: number, root: ParentNode | null }
let configuredRepository: Repository | null = null

export function configurePdfAnnotationRepository(repository: Repository | null) {
  configuredRepository = repository
}

export function createPdfAnnotationStore({ repository }: { repository?: Repository } = {}) {
  return defineStore('pdf-annotations', () => {
    const annotations = shallowRef<Annotation[]>([])
    const recordId = shallowRef<string | null>(null)
    const generation = shallowRef(0)
    const zoom = shallowRef(1)
    const root = shallowRef<ParentNode | null>(null)
    const error = shallowRef<string | null>(null)
    const query = shallowRef('')
    const type = shallowRef<'all' | 'notes' | 'highlights' | 'pdf' | 'ebook'>('all')
    const sort = shallowRef<'newest' | 'oldest' | 'location'>('newest')
    const selected = shallowRef<string[]>([])
    const visible = computed(() => sortAnnotations(filterAnnotations(annotations.value, { query: query.value, type: type.value }), sort.value))
    let writeId = 0

    function synchronizeSession(session: Session) {
      const identityChanged = recordId.value !== session.record?.id || generation.value !== session.generation || root.value !== session.root
      const zoomChanged = zoom.value !== session.zoom
      if (identityChanged) clear()
      else if (zoomChanged && root.value) clearPdfAnnotationOverlays(root.value)
      recordId.value = session.record?.id ?? null
      generation.value = session.generation
      zoom.value = session.zoom
      root.value = session.root
      if (identityChanged) annotations.value = session.record?.annotations?.filter(item => item.kind === 'pdf') ?? []
      renderAll()
    }

    async function createFromSelection(options: CreatePdfAnnotationFromRangeOptions & { generation: number }) {
      if (options.generation !== generation.value || !recordId.value) return null
      const annotation = createPdfAnnotationFromRange(options)
      if (!annotation) return null
      annotations.value = [...annotations.value, annotation]
      renderAll()
      await persist(options.generation, recordId.value)
      return annotation
    }

    async function update(id: string, changes: { note?: unknown, tags?: unknown }) {
      annotations.value = updateAnnotation(annotations.value, id, changes)
      renderAll()
      await persist(generation.value, recordId.value)
    }

    async function remove(id: string) {
      annotations.value = annotations.value.filter(item => item.id !== id)
      selected.value = selected.value.filter(value => value !== id)
      renderAll()
      await persist(generation.value, recordId.value)
    }

    async function removeSelected() {
      const ids = new Set(selected.value)
      annotations.value = annotations.value.filter(item => !ids.has(item.id))
      selected.value = []
      renderAll()
      await persist(generation.value, recordId.value)
    }

    function renderPage(page: number) {
      if (!root.value) return
      renderPdfAnnotationOverlays({ root: root.value, annotations: annotations.value, page, onResolved: (annotation, resolved) => {
        if (annotation.anchor?.kind !== 'pdf') return
        annotation.rects = resolved.rects
        annotation.anchor = { ...annotation.anchor, textOffset: resolved.textOffset }
        annotation.anchorStatus = 'resolved'
      } })
    }

    function renderAll() {
      if (!root.value) return
      renderPdfAnnotationOverlays({ root: root.value, annotations: annotations.value, onResolved: (annotation, resolved) => {
        if (annotation.anchor?.kind !== 'pdf') return
        annotation.rects = resolved.rects
        annotation.anchor = { ...annotation.anchor, textOffset: resolved.textOffset }
        annotation.anchorStatus = 'resolved'
      } })
    }

    async function recoverImported() { renderAll() }

    function clear() {
      if (root.value) clearPdfAnnotationOverlays(root.value)
      annotations.value = []
      selected.value = []
      error.value = null
    }

    async function persist(expectedGeneration: number, expectedRecordId: string | null) {
      if (!expectedRecordId || expectedGeneration !== generation.value || expectedRecordId !== recordId.value) return
      const write = ++writeId
      try {
        const target = repository ?? configuredRepository
        if (!target) throw new Error('批注存储不可用')
        await target.update(expectedRecordId, { annotations: annotations.value })
      } catch {
        if (write === writeId && expectedGeneration === generation.value && expectedRecordId === recordId.value) error.value = '批注保存失败，可稍后重试'
      }
    }

    return { annotations, recordId, generation, zoom, root, error, query, type, sort, selected, visible, synchronizeSession, createFromSelection, update, remove, removeSelected, renderPage, recoverImported, clear }
  })
}

export const usePdfAnnotationStore = createPdfAnnotationStore()
