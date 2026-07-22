import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Could not apply Foliate patch: ${label}`)
  return source.replace(before, after)
}

const patchFile = async (relativePath, transform) => {
  const path = new URL(relativePath, new URL('../', import.meta.url))
  const source = await readFile(path, 'utf8')
  const patched = transform(source)
  if (patched !== source) await writeFile(path, patched)
}

await patchFile('node_modules/foliate-js/paginator.js', source => {
  const oldBodyHelper = `const getBody = doc => doc?.body ?? doc?.querySelector?.('body')`
  const bodyHelper = `${oldBodyHelper}
        ?? doc?.getElementsByTagNameNS?.('*', 'body')?.[0]`
  if (!source.includes(bodyHelper)) source = source.replace(oldBodyHelper, bodyHelper)
  source = replaceOnce(source,
    `const setStylesImportant = (el, styles) => {
    const { style } = el`,
    `const getBody = doc => doc?.body ?? doc?.querySelector?.('body')
        ?? doc?.getElementsByTagNameNS?.('*', 'body')?.[0]

const setStylesImportant = (el, styles) => {
    if (!el?.style) return
    const { style } = el`,
    'safe XHTML body and style access')
  source = source.replaceAll('doc.body', 'getBody(doc)')
  source = source.replaceAll('this.document.body', 'getBody(this.document)')
  source = replaceOnce(source,
    `                const doc = this.document
                afterLoad?.(doc)`,
    `                const doc = this.document
                const body = getBody(doc)
                if (!doc?.documentElement || !body) {
                    resolve()
                    return
                }
                afterLoad?.(doc)`,
    'skip malformed or unloaded chapter documents')
  source = replaceOnce(source,
    `    render(layout) {
        if (!layout || !this.document) return`,
    `    render(layout) {
        if (!layout || !this.document?.documentElement || !getBody(this.document)) return`,
    'render lifecycle guard')
  source = replaceOnce(source,
    `    expand() {
        const { documentElement } = this.document`,
    `    expand() {
        const documentElement = this.document?.documentElement
        if (!documentElement || !getBody(this.document)) return`,
    'resize lifecycle guard')
  source = replaceOnce(source,
    `    destroy() {
        if (this.document) this.#observer.unobserve(getBody(this.document))`,
    `    destroy() {
        const body = getBody(this.document)
        if (body) this.#observer.unobserve(body)`,
    'destroy lifecycle guard')
  source = replaceOnce(source,
    `            this.#iframe.src = src`,
    `            if (src.startsWith('blob:')) {
                fetch(src).then(response => response.text())
                    .then(html => { this.#iframe.srcdoc = html })
                    .catch(() => { this.#iframe.src = src })
            } else this.#iframe.src = src`,
    'load blob chapters through srcdoc')
  return source.replace(
    `this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')`,
    `this.#iframe.setAttribute('sandbox', 'allow-same-origin')`)
})

await patchFile('node_modules/foliate-js/view.js', source => {
  source = replaceOnce(source,
    `const languageInfo = lang => {`,
    `const normalizeLanguageTag = lang => typeof lang === 'string'
    ? lang.replace(/^zh-cmn(?=-|$)/i, 'zh')
    : lang

const languageInfo = lang => {`,
    'legacy Chinese language tag normalization')
  return replaceOnce(source,
    `        const canonical = Intl.getCanonicalLocales(lang)[0]`,
    `        const canonical = Intl.getCanonicalLocales(normalizeLanguageTag(lang))[0]`,
    'canonical language normalization')
})

console.log(`Patched Foliate compatibility in ${root}`)
