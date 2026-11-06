<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useReaderStore } from '../stores/reader'
import { useSettingsStore, type ReaderFont } from '../stores/settings'
import { dismissReaderPanel } from '../panel-focus'

const reader = useReaderStore()
const settings = useSettingsStore()
const { activePanel } = storeToRefs(reader)
const { flow, font, fontSize, lineHeight, pageWidth, theme } = storeToRefs(settings)

function updateFont(event: Event) {
  void settings.updateFont((event.target as HTMLSelectElement).value as ReaderFont)
}

function updateNumber(event: Event, update: (value: number) => Promise<boolean>) {
  void update(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <aside id="settings-panel" class="settings-panel" :class="{ open: activePanel === 'settings' }" :inert="activePanel !== 'settings'" aria-label="阅读设置">
    <div class="panel-header">
      <div><p class="eyebrow">READING</p><h2>阅读设置</h2></div>
      <button id="close-settings" class="icon-button" aria-label="关闭阅读设置" @click="dismissReaderPanel(reader)">×</button>
    </div>
    <div class="setting-group ebook-setting">
      <label>阅读方式</label>
      <div class="segmented" role="group" aria-label="阅读方式"><button type="button" data-flow="paginated" :class="{ active: flow === 'paginated' }" :aria-pressed="flow === 'paginated'" @click="settings.updateFlow('paginated')">分页</button><button type="button" data-flow="scrolled" :class="{ active: flow === 'scrolled' }" :aria-pressed="flow === 'scrolled'" @click="settings.updateFlow('scrolled')">滚动</button></div>
    </div>
    <div class="setting-group ebook-setting"><label for="font-select">正文字体</label><select id="font-select" :value="font" @change="updateFont"><option value="serif">宋体 / 衬线</option><option value="sans">黑体 / 无衬线</option><option value="system">系统字体</option></select></div>
    <div class="setting-group ebook-setting"><label for="font-size">字号 <output id="font-size-value" aria-hidden="true">{{ fontSize }}</output></label><input id="font-size" type="range" min="14" max="32" :value="fontSize" :aria-valuetext="`${fontSize} 像素`" @input="updateNumber($event, settings.updateFontSize)"></div>
    <div class="setting-group ebook-setting"><label for="line-height">行距 <output id="line-height-value" aria-hidden="true">{{ lineHeight.toFixed(2) }}</output></label><input id="line-height" type="range" min="1.3" max="2.2" step="0.05" :value="lineHeight" :aria-valuetext="`${lineHeight.toFixed(2)} 倍`" @input="updateNumber($event, settings.updateLineHeight)"></div>
    <div class="setting-group ebook-setting"><label for="page-width">栏宽 <output id="page-width-value" aria-hidden="true">{{ pageWidth }}</output></label><input id="page-width" type="range" min="520" max="1000" step="20" :value="pageWidth" :aria-valuetext="`${pageWidth} 像素`" @input="updateNumber($event, settings.updatePageWidth)"></div>
    <div class="setting-group">
      <label>页面主题</label>
      <div class="theme-options" role="group" aria-label="页面主题"><button type="button" data-theme="paper" title="纸张" aria-label="纸张主题" class="paper" :class="{ active: theme === 'paper' }" :aria-pressed="theme === 'paper'" @click="settings.updateTheme('paper')" /><button type="button" data-theme="light" title="明亮" aria-label="明亮主题" class="light" :class="{ active: theme === 'light' }" :aria-pressed="theme === 'light'" @click="settings.updateTheme('light')" /><button type="button" data-theme="sepia" title="暖黄" aria-label="暖黄主题" class="sepia" :class="{ active: theme === 'sepia' }" :aria-pressed="theme === 'sepia'" @click="settings.updateTheme('sepia')" /><button type="button" data-theme="dark" title="深色" aria-label="深色主题" class="dark" :class="{ active: theme === 'dark' }" :aria-pressed="theme === 'dark'" @click="settings.updateTheme('dark')" /></div>
    </div>
    <p id="panel-tip" class="panel-tip">方向键翻页，Esc 收起面板</p>
  </aside>
</template>
