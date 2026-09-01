<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useEbookSessionStore } from '../stores/ebook-session'
import { useReaderStore } from '../stores/reader'

const { activePanel } = storeToRefs(useReaderStore())
const ebook = useEbookSessionStore()
const { record, toc } = storeToRefs(ebook)
const ebookSessionActive = computed(() => record.value !== null)

function goTo(event: MouseEvent, href: unknown) {
  if (!ebookSessionActive.value) return
  event.stopImmediatePropagation()
  void ebook.goTo(href)
}
</script>

<template>
  <aside id="sidebar" class="sidebar" :class="{ open: activePanel === 'toc', 'ebook-session-toc': ebookSessionActive }" aria-label="书籍目录">
    <div class="sidebar-book">
      <div id="sidebar-cover" class="cover-placeholder"><span id="cover-letter">静</span></div>
      <div class="sidebar-meta">
        <strong id="sidebar-title">未命名书籍</strong><span id="sidebar-author">未知作者</span><small id="sidebar-format">EPUB</small>
      </div>
    </div>
    <div class="sidebar-label"><span>目录</span><span id="toc-count"><template v-if="ebookSessionActive">{{ toc.length }}</template></span></div>
    <nav id="toc" class="toc">
      <ul v-if="ebookSessionActive">
        <li v-for="(item, index) in toc" :key="`${index}-${item.label}`">
          <button type="button" @click="goTo($event, item.href)">{{ item.label }}</button>
          <ul v-if="item.subitems?.length">
            <li v-for="(subitem, subindex) in item.subitems" :key="`${index}-${subindex}-${subitem.label}`">
              <button type="button" @click="goTo($event, subitem.href)">{{ subitem.label }}</button>
            </li>
          </ul>
        </li>
      </ul>
    </nav>
  </aside>
</template>
