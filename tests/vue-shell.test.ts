// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import App from '../entrypoints/reader/App.vue'
import { connectLegacyReaderState } from '../entrypoints/reader/legacy-bridge'
import { useReaderStore } from '../entrypoints/reader/stores/reader'
import { useSettingsStore } from '../entrypoints/reader/stores/settings'
import { useMigrationStore } from '../entrypoints/reader/stores/migration'

afterEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
  document.body.className = ''
})

describe('Vue reader shell', () => {
  test('renders all legacy reader integration points through components', () => {
    const pinia = createPinia()
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    for (const id of [
      'app-header', 'welcome-view', 'book-grid', 'reader-view', 'toc',
      'settings-panel', 'tools-panel', 'selection-ai-menu', 'file-input',
    ]) {
      expect(wrapper.find(`#${id}`).exists()).toBe(true)
    }
    wrapper.unmount()
  })

  test('Pinia stores runtime UI state without owning persisted books', () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    expect(store.$state).toEqual({
      title: '未命名书籍',
      chapter: '开始',
      progress: 0,
      isReading: false,
      activePanel: null,
    })
    expect('books' in store.$state).toBe(false)
    expect('annotations' in store.$state).toBe(false)
  })

  test('projects structured legacy reader state callbacks into Pinia', () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    const bridge = connectLegacyReaderState(pinia)

    bridge.callbacks.onState({ title: '海边的卡夫卡', isReading: true })
    bridge.callbacks.onState({ chapter: '第一章', progress: 0.375 })
    bridge.callbacks.onPanelRequest('toc')

    expect(store.$state).toEqual({
      title: '海边的卡夫卡',
      chapter: '第一章',
      progress: 0.375,
      isReading: true,
      activePanel: 'toc',
    })
  })

  test('renders panel classes from Pinia and closes panels through Vue controls', async () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    await wrapper.find('#sidebar-button').trigger('click')
    expect(store.activePanel).toBe('toc')
    expect(wrapper.find('#sidebar').classes()).toContain('open')
    expect(wrapper.find('#scrim').classes()).toContain('show')

    await wrapper.find('#settings-button').trigger('click')
    expect(store.activePanel).toBe('settings')
    expect(wrapper.find('#sidebar').classes()).not.toContain('open')
    expect(wrapper.find('#settings-panel').classes()).toContain('open')

    await wrapper.find('#close-settings').trigger('click')
    expect(store.activePanel).toBeNull()
    expect(wrapper.find('#settings-panel').classes()).not.toContain('open')
    expect(wrapper.find('#scrim').classes()).not.toContain('show')

    wrapper.unmount()
  })

  test('closes the active panel from the scrim and Escape key', async () => {
    const pinia = createPinia()
    const store = useReaderStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    await wrapper.find('#tools-button').trigger('click')
    await wrapper.find('#scrim').trigger('click')
    expect(store.activePanel).toBeNull()

    await wrapper.find('#tools-button').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(store.activePanel).toBeNull()
    expect(wrapper.find('#tools-panel').classes()).not.toContain('open')

    wrapper.unmount()
  })

  test('binds settings controls to Pinia state and Vue events', async () => {
    localStorage.setItem('quiet-reader-settings', JSON.stringify({
      theme: 'sepia',
      flow: 'scrolled',
      font: 'system',
      fontSize: 24,
      lineHeight: 1.9,
      pageWidth: 880,
    }))
    const pinia = createPinia()
    const store = useSettingsStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    expect(wrapper.find('[data-theme="sepia"]').classes()).toContain('active')
    expect(wrapper.find('[data-flow="scrolled"]').classes()).toContain('active')
    expect((wrapper.find('#font-select').element as HTMLSelectElement).value).toBe('system')
    expect((wrapper.find('#font-size').element as HTMLInputElement).value).toBe('24')
    expect(wrapper.find('#line-height-value').text()).toBe('1.90')
    expect(wrapper.find('#page-width-value').text()).toBe('880')

    await wrapper.find('[data-theme="dark"]').trigger('click')
    await wrapper.find('[data-flow="paginated"]').trigger('click')
    expect(store.theme).toBe('dark')
    expect(store.flow).toBe('paginated')
    expect(wrapper.find('[data-theme="dark"]').classes()).toContain('active')
    expect(wrapper.find('[data-flow="paginated"]').classes()).toContain('active')

    wrapper.unmount()
  })

  test('persists the collapsed header state through the settings store', async () => {
    const pinia = createPinia()
    const store = useSettingsStore(pinia)
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })

    await wrapper.find('#header-toggle').trigger('click')

    expect(store.headerCollapsed).toBe(true)
    expect(wrapper.find('#header-toggle').attributes('aria-expanded')).toBe('false')
    expect(JSON.parse(localStorage.getItem('quiet-reader-settings') || '{}')).toMatchObject({ headerCollapsed: true })

    wrapper.unmount()
  })

  test('shows a persistent migration recovery view with safe actions', () => {
    const pinia = createPinia()
    const store = useMigrationStore(pinia)
    store.fail({
      code: 'missing-store',
      message: '数据库缺少 meta 对象仓库',
      diagnostic: {
        databaseExists: true,
        databaseVersion: 2,
        stores: ['books'],
        schemaVersion: null,
        bookCount: 1,
        settingsKey: 'quiet-reader-settings',
        settingsKeys: ['aiApiKey'],
        settingsWarnings: [],
      },
    })

    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
    expect(wrapper.find('#migration-error-view').isVisible()).toBe(true)
    expect(wrapper.find('#migration-export-diagnostic').exists()).toBe(true)
    expect(wrapper.find('#migration-restore-backup').exists()).toBe(true)
    expect(wrapper.find('#migration-return-library').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('secret')
    expect(wrapper.find('#welcome-view').exists()).toBe(false)
    wrapper.unmount()
  })
})
