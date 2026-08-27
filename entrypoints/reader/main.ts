import { createPinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import '../../styles/reader.css'
import App from './App.vue'
import { connectLegacyReaderState } from './legacy-bridge'
import type { LegacyReaderPort } from './legacy-reader-port'
import { runMigrationPreflight } from './migration-preflight'
import { useMigrationStore } from './stores/migration'

async function startReader() {
  const pinia = createPinia()
  createApp(App).use(pinia).mount('#app')
  await nextTick()
  const migration = useMigrationStore(pinia)
  const preflight = await runMigrationPreflight()
  document.documentElement.dataset.migrationPreflight = preflight.ok ? 'ready' : 'failed'
  if (!preflight.ok) {
    migration.fail(preflight.error)
    await nextTick()
  }
  if (!preflight.ok) return
  migration.ready()
  const bridge = connectLegacyReaderState(pinia)
  document.documentElement.dataset.legacyController = 'loading'
  // The imperative controller remains JavaScript until its engine adapters move to TypeScript.
  // @ts-expect-error JavaScript compatibility controller has no declaration file yet.
  const legacyReader = await import('../../src/reader.js')
  const port: LegacyReaderPort = legacyReader.createLegacyReaderPort(bridge.callbacks)
  bridge.attachPort(port)
  document.documentElement.dataset.legacyController = 'ready'
}

await startReader()
