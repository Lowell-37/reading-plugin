import { defineConfig } from 'wxt'

export default defineConfig({
  manifest: {
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
    build: {
      target: 'es2022',
    },
  }),
})
