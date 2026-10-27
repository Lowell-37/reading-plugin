<script setup lang="ts">
import { computed, defineComponent, h, type Component, type PropType } from 'vue'
import { storeToRefs } from 'pinia'
import type { EbookSessionTocItem } from '../ebook-session-port'
import type { PdfOutlineItem } from '../pdf-session-port'
import { useEbookSessionStore } from '../stores/ebook-session'
import { usePdfSessionStore } from '../stores/pdf-session'
import { useReaderStore } from '../stores/reader'
import { closePanelAndFocusReader } from '../panel-focus'

const reader = useReaderStore()
const { activePanel } = storeToRefs(reader)
const ebook = useEbookSessionStore()
const pdf = usePdfSessionStore()
const { record, title, toc, activeTocHref } = storeToRefs(ebook)
const { record: pdfRecord, title: pdfTitle, outline, page: pdfPage } = storeToRefs(pdf)
const ebookSessionActive = computed(() => record.value !== null)
const pdfSessionActive = computed(() => pdfRecord.value !== null)
const activePdfPath = computed(() => {
  if (!pdfSessionActive.value) return null
  let selected: string | null = null
  let nearestPage = 0
  const visit = (items: PdfOutlineItem[], path = '') => {
    items.forEach((item, index) => {
      const key = `${path}${index}`
      // The outline may be unsorted. Equal-page entries follow document order.
      if (item.page !== null && item.page > 0 && item.page <= pdfPage.value && item.page >= nearestPage) {
        selected = key
        nearestPage = item.page
      }
      if (item.children) visit(item.children, `${key}/`)
    })
  }
  visit(outline.value)
  return selected
})
const tocCount = computed(() => pdfSessionActive.value
  ? countItems(outline.value, item => item.children)
  : ebookSessionActive.value ? countItems(toc.value, item => item.subitems) : 0)

function countItems<T>(items: T[], children: (item: T) => T[] | undefined): number {
  return items.reduce((total, item) => total + 1 + countItems(children(item) ?? [], children), 0)
}

function goTo(event: MouseEvent, href: unknown) {
  if (!ebookSessionActive.value) return
  event.stopImmediatePropagation()
  void ebook.goTo(href)
  closePanelAndFocusReader(reader)
}

function goToPdf(event: MouseEvent, page: number | null) {
  if (!pdfSessionActive.value || page === null) return
  event.stopImmediatePropagation()
  void pdf.goTo(page)
  closePanelAndFocusReader(reader)
}

const TocItems: Component = defineComponent({
  name: 'EbookSessionTocItems',
  props: {
    items: { type: Array as PropType<EbookSessionTocItem[]>, required: true },
    path: { type: String, default: '' },
  },
  emits: ['go-to'],
  setup(props, { emit }) {
    return () => h('ul', props.items.map((item, index) => {
      const key = `${props.path}${index}-${item.label}`
      return h('li', { key }, [
        h('button', {
          type: 'button',
          class: { active: activeTocHref.value !== null && item.href === activeTocHref.value },
          'aria-current': activeTocHref.value !== null && item.href === activeTocHref.value ? 'location' : undefined,
          onClick: (event: MouseEvent) => emit('go-to', event, item.href),
        }, item.label),
        item.subitems?.length
          ? h(TocItems, {
              items: item.subitems,
              path: `${key}/`,
              onGoTo: (event: MouseEvent, href: unknown) => emit('go-to', event, href),
            })
          : null,
      ])
    }))
  },
})

const PdfOutlineItems: Component = defineComponent({
  name: 'PdfSessionOutlineItems',
  props: {
    items: { type: Array as PropType<PdfOutlineItem[]>, required: true },
    path: { type: String, default: '' },
  },
  emits: ['go-to'],
  setup(props, { emit }) {
    return () => h('ul', props.items.map((item, index) => {
      const key = `${props.path}${index}`
      return h('li', { key }, [
        h('button', {
          type: 'button',
          disabled: item.page === null,
          class: { active: activePdfPath.value === key },
          'aria-current': activePdfPath.value === key ? 'location' : undefined,
          onClick: (event: MouseEvent) => emit('go-to', event, item.page),
        }, item.label),
        item.children?.length
          ? h(PdfOutlineItems, {
              items: item.children,
              path: `${key}/`,
              onGoTo: (event: MouseEvent, page: number | null) => emit('go-to', event, page),
            })
          : null,
      ])
    }))
  },
})
</script>

<template>
  <aside id="sidebar" class="sidebar" :class="{ open: activePanel === 'toc', 'ebook-session-toc': ebookSessionActive, 'pdf-session-toc': pdfSessionActive }" :inert="activePanel !== 'toc'" aria-label="书籍目录">
    <div class="sidebar-book">
      <div id="sidebar-cover" class="cover-placeholder"><span id="cover-letter">静</span></div>
      <div class="sidebar-meta">
        <strong id="sidebar-title"><template v-if="pdfSessionActive">{{ pdfTitle }}</template><template v-else-if="ebookSessionActive">{{ title }}</template><template v-else>未命名书籍</template></strong><span id="sidebar-author">未知作者</span><small id="sidebar-format">{{ pdfSessionActive ? 'PDF' : record?.format.toUpperCase() ?? 'EPUB' }}</small>
      </div>
    </div>
    <div class="sidebar-label"><span>目录</span><span id="toc-count">{{ tocCount ? `${tocCount} 项` : '' }}</span></div>
    <nav id="toc" class="toc">
      <p v-if="(pdfSessionActive || ebookSessionActive) && !tocCount" class="toc-empty">这本书没有提供目录</p>
      <PdfOutlineItems v-else-if="pdfSessionActive" :items="outline" @go-to="goToPdf" />
      <TocItems v-else-if="ebookSessionActive" :items="toc" @go-to="goTo" />
    </nav>
  </aside>
</template>
