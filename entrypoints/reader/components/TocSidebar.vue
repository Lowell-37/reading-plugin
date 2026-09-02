<script setup lang="ts">
import { computed, defineComponent, h, type Component, type PropType } from 'vue'
import { storeToRefs } from 'pinia'
import type { EbookSessionTocItem } from '../ebook-session-port'
import { useEbookSessionStore } from '../stores/ebook-session'
import { useReaderStore } from '../stores/reader'

const { activePanel } = storeToRefs(useReaderStore())
const ebook = useEbookSessionStore()
const { record, title, toc } = storeToRefs(ebook)
const ebookSessionActive = computed(() => record.value !== null)

function goTo(event: MouseEvent, href: unknown) {
  if (!ebookSessionActive.value) return
  event.stopImmediatePropagation()
  void ebook.goTo(href)
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
</script>

<template>
  <aside id="sidebar" class="sidebar" :class="{ open: activePanel === 'toc', 'ebook-session-toc': ebookSessionActive }" aria-label="书籍目录">
    <div class="sidebar-book">
      <div id="sidebar-cover" class="cover-placeholder"><span id="cover-letter">静</span></div>
      <div class="sidebar-meta">
        <strong id="sidebar-title"><template v-if="ebookSessionActive">{{ title }}</template><template v-else>未命名书籍</template></strong><span id="sidebar-author">未知作者</span><small id="sidebar-format">EPUB</small>
      </div>
    </div>
    <div class="sidebar-label"><span>目录</span><span id="toc-count"><template v-if="ebookSessionActive">{{ toc.length }}</template></span></div>
    <nav id="toc" class="toc">
      <TocItems v-if="ebookSessionActive" :items="toc" @go-to="goTo" />
    </nav>
  </aside>
</template>
