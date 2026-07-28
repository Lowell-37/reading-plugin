<script setup lang="ts">
import OverlayControls from './components/OverlayControls.vue'
import ReaderWorkspace from './components/ReaderWorkspace.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ToolsPanel from './components/ToolsPanel.vue'
import TopBar from './components/TopBar.vue'
import WelcomeLibrary from './components/WelcomeLibrary.vue'
</script>

<template>
  <TopBar />
  <WelcomeLibrary />
  <ReaderWorkspace />
  <SettingsPanel />
  <ToolsPanel />
  <OverlayControls />
</template>
