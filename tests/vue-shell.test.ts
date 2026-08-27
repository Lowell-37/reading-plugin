// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import App from '../entrypoints/reader/App.vue'
import { useReaderStore } from '../entrypoints/reader/stores/reader'
import { useMigrationStore } from '../entrypoints/reader/stores/migration'

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
