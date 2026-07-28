import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'wxt'

export default defineConfig({
  manifest: {
    // Keep the extension origin stable across local build/output paths so
    // IndexedDB and localStorage remain attached to the same extension ID.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0g0E4stfMlF+EpvHNNuQb6l7FAAUUYX0WacsAIyn4LR/3reCBM1mJcTBW2a8E7oZqZNtLpnz+vBnykzur/uJasUsEuZwErg5PvDGpGgeC3KyTK1Z9WcWXN9XZnfGKyPaMO8Q61fNggCUJuZKQa41Yf3+lzFHFeESN7z1sbYy7PN+deQ6wGAY8SACwSBAGdRyJv1lXodVLwjBokGK3LS/IKcimBcwaCar3yDpT22aGc/ev4aeMeZtwoKft1lng/SdyqlFEpEa6c3CZWXjmsuenTa+b/wgbtHSYMqS9v5teC6Stcgmv4Z0P9/lRUsr806c1LdZ/2kiw//UqR2qo16ppQIDAQAB',
    name: '静读 · 本地电子书阅读器',
    short_name: '静读',
    version: '0.2.0',
    description: '在浏览器中离线阅读 PDF、EPUB、MOBI 与 AZW3 电子书。',
    action: {
      default_title: '打开静读',
    },
    permissions: ['storage'],
    optional_host_permissions: [
      'https://*/*',
      'http://*/*',
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; frame-src 'self' blob:; connect-src 'self' https: http:",
    },
  },
  vite: () => ({
    plugins: [vue()],
    build: {
      target: 'es2022',
    },
  }),
})
