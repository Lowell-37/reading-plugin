<script setup lang="ts">
import { ref } from 'vue'
import { useMigrationStore } from '../stores/migration'

const store = useMigrationStore()
const backupInput = ref<HTMLInputElement | null>(null)

function exportDiagnostic() {
  if (!store.error) return
  const payload = new Blob([JSON.stringify({
    generatedAt: new Date().toISOString(),
    error: store.error,
  }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(payload)
  const link = document.createElement('a')
  link.href = url
  link.download = `quiet-reader-migration-diagnostic-${Date.now()}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  store.setRecoveryStatus('诊断已导出；文件不包含书籍正文或 API 密钥。')
}

function selectBackup() {
  backupInput.value?.click()
}

function explainBackupRecovery() {
  store.setRecoveryStatus('已选择备份。为避免覆盖原库，请先加载根目录稳定版，再使用书架中的“恢复备份”。')
}

function retry() {
  location.reload()
}
</script>

<template>
  <main id="migration-error-view" class="welcome-view migration-error-view" role="alert">
    <section class="hero">
      <p class="eyebrow">DATA SAFETY CHECK</p>
      <h1>本地书库需要检查</h1>
      <p>{{ store.error?.message }}</p>
      <p class="drop-hint">错误代码：{{ store.error?.code }}</p>
      <div class="library-backup-actions" aria-label="迁移恢复操作">
        <button id="migration-export-diagnostic" class="soft-button" type="button" @click="exportDiagnostic">导出诊断</button>
        <button id="migration-restore-backup" class="soft-button" type="button" @click="selectBackup">恢复备份</button>
        <button id="migration-return-library" class="primary-button" type="button" @click="retry">重新检查并返回书架</button>
      </div>
      <input ref="backupInput" type="file" accept=".quietreader,application/vnd.quiet-reader.backup" hidden @change="explainBackupRecovery">
      <p aria-live="polite">{{ store.recoveryStatus || '预检没有修改或清空任何本地数据。' }}</p>
    </section>
  </main>
</template>
