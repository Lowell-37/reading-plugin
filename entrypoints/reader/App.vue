<script setup lang="ts">
import { useMigrationStore } from './stores/migration'
import MigrationErrorView from './components/MigrationErrorView.vue'
import OverlayControls from './components/OverlayControls.vue'
import ReaderWorkspace from './components/ReaderWorkspace.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ToolsPanel from './components/ToolsPanel.vue'
import TopBar from './components/TopBar.vue'
import WelcomeLibrary from './components/WelcomeLibrary.vue'

const migration = useMigrationStore()
</script>

<template>
  <MigrationErrorView v-if="migration.status === 'failed'" />
  <template v-else>
    <TopBar />
    <WelcomeLibrary />
    <ReaderWorkspace />
    <SettingsPanel />
    <ToolsPanel />
    <OverlayControls />
  </template>
</template>
