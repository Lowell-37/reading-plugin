import { createPinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import '../../styles/reader.css'
import App from './App.vue'
import { connectLegacyReaderState } from './legacy-bridge'

const pinia = createPinia()
createApp(App).use(pinia).mount('#app')
await nextTick()
connectLegacyReaderState(pinia)
// The imperative controller remains JavaScript until its engine adapters move to TypeScript.
// @ts-expect-error JavaScript compatibility controller has no declaration file yet.
await import('../../src/reader.js')
