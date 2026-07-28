import { Overlayer } from '../node_modules/foliate-js/overlayer.js'
import { activeSectionIndex, clamp, interpolateSectionProgress } from './continuous-layout.js'

export class ContinuousEbookScroller extends EventTarget {
  #host
  #view
  #book
  #container
  #items = new Map()
  #observer
  #scrollFrame = null
  #styles = ''
  #annotations = []
  #destroyed = false
  #onDocumentLoad
  #onSelection
  #onExternalLink
  #onAnnotation

  constructor({
    host,
    view,
    styles = '',
    annotations = [],
    onDocumentLoad,
    onSelection,
    onExternalLink,
    onAnnotation,
  }) {
    super()
    this.#host = host
    this.#view = view
    this.#book = view.book
    this.#styles = styles
    this.#annotations = annotations
    this.#onDocumentLoad = onDocumentLoad
    this.#onSelection = onSelection
    this.#onExternalLink = onExternalLink
    this.#onAnnotation = onAnnotation

    this.#container = document.createElement('div')
    this.#container.className = 'continuous-ebook'
    this.#container.addEventListener('scroll', () => {
      if (this.#scrollFrame != null) return
      this.#scrollFrame = requestAnimationFrame(() => {
        this.#scrollFrame = null
        this.#emitRelocate()
      })
    }, { passive: true })
  }

  get element() {
    return this.#container
  }

  get currentIndex() {
    const layout = [...this.#items.values()].map(({ wrapper, index }) => ({
      index,
      top: wrapper.offsetTop,
      bottom: wrapper.offsetTop + wrapper.offsetHeight,
    }))
    return activeSectionIndex(layout,
      this.#container.scrollTop + this.#container.clientHeight / 2)
  }

  async mount(target) {
    const placeholderHeight = Math.max(420, this.#host.clientHeight * .82)
    const fragment = document.createDocumentFragment()
    for (const [index, section] of this.#book.sections.entries()) {
      if (!section?.load || section.linear === 'no') continue
      const wrapper = document.createElement('section')
      wrapper.className = 'continuous-section'
      wrapper.dataset.sectionIndex = index
      wrapper.style.height = `${placeholderHeight}px`
      wrapper.setAttribute('aria-label', `电子书章节 ${index + 1}`)
      const placeholder = document.createElement('div')
      placeholder.className = 'continuous-section-placeholder'
      placeholder.textContent = '正在准备章节…'
      wrapper.append(placeholder)
      fragment.append(wrapper)
      this.#items.set(index, {
        index,
        section,
        wrapper,
        placeholder,
        iframe: null,
        doc: null,
        loaded: false,
        overlayer: null,
        annotationKeys: new Set(),
        loadPromise: null,
        resizeObserver: null,
      })
    }
    this.#container.append(fragment)
    this.#host.append(this.#container)

    this.#observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const index = Number(entry.target.dataset.sectionIndex)
        this.#load(index).catch(error => {
          console.error(error)
          const item = this.#items.get(index)
          if (item) item.placeholder.textContent = '这一章暂时无法显示'
        })
      }
    }, { root: this.#container, rootMargin: '140% 0px' })
    for (const { wrapper } of this.#items.values()) this.#observer.observe(wrapper)

    const resolved = this.#resolveTarget(target)
    const index = this.#normalizeIndex(resolved?.index)
    await Promise.all([this.#load(index), this.#load(this.#adjacent(index, 1))])
    await this.#scrollToResolved({ ...resolved, index }, false)
    this.#emitRelocate()
  }

  #resolveTarget(target) {
    if (target?.cfi) return this.#view.resolveNavigation(target.cfi)
    if (typeof target?.fraction === 'number')
      return this.#view.resolveNavigation({ fraction: target.fraction })
    if (target == null) return { index: this.#normalizeIndex(0), anchor: 0 }
    return this.#view.resolveNavigation(target) || { index: this.#normalizeIndex(0) }
  }

  #normalizeIndex(index) {
    if (this.#items.has(index)) return index
    const indices = [...this.#items.keys()]
    if (!indices.length) return -1
    return indices.reduce((best, value) =>
      Math.abs(value - (Number(index) || 0)) < Math.abs(best - (Number(index) || 0))
        ? value : best)
  }

  #adjacent(index, direction) {
    const indices = [...this.#items.keys()]
    const position = indices.indexOf(index)
    return indices[position + direction]
  }

  async #load(index) {
    const item = this.#items.get(index)
    if (!item || this.#destroyed) return null
    if (item.doc) return item
    if (item.loadPromise) return item.loadPromise

    item.loadPromise = Promise.resolve(item.section.load()).then(src => {
      if (!src) return null
      item.loaded = true
      if (this.#destroyed) {
        item.section.unload?.()
        item.loaded = false
        return null
      }
      const iframe = document.createElement('iframe')
      iframe.className = 'continuous-section-frame'
      iframe.setAttribute('sandbox', 'allow-same-origin')
      iframe.setAttribute('scrolling', 'no')
      iframe.title = `电子书章节 ${index + 1}`
      item.iframe = iframe
      item.wrapper.replaceChildren(iframe)
      return new Promise((resolve, reject) => {
        iframe.addEventListener('error', () => reject(new Error(`章节 ${index + 1} 加载失败`)), { once: true })
        iframe.addEventListener('load', () => {
          const doc = iframe.contentDocument
          if (!doc?.documentElement) {
            reject(new Error(`章节 ${index + 1} 没有可显示的正文`))
            return
          }
          item.doc = doc
          this.#prepareDocument(item)
          resolve(item)
        }, { once: true })
        iframe.src = src
      })
    }).finally(() => {
      item.loadPromise = null
    })
    return item.loadPromise
  }

  #prepareDocument(item) {
    const { doc, iframe, index, section, wrapper } = item
    const style = doc.createElement('style')
    style.dataset.quietReaderContinuous = ''
    style.textContent = `${this.#styles}
      html { height:auto !important; min-height:0 !important; overflow:hidden !important; }
      body { box-sizing:border-box !important; height:auto !important; min-height:0 !important;
        overflow:visible !important; margin:0 auto !important; padding-top:52px !important;
        padding-bottom:52px !important; }
    `
    doc.head?.append(style)

    const updateHeight = () => {
      if (this.#destroyed || !item.doc) return
      const before = wrapper.offsetHeight
      const aboveViewport = wrapper.offsetTop < this.#container.scrollTop
      const height = Math.max(
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight || 0,
        doc.body?.getBoundingClientRect().bottom || 0,
        160,
      )
      iframe.style.height = `${Math.ceil(height)}px`
      wrapper.style.height = `${Math.ceil(height)}px`
      const delta = wrapper.offsetHeight - before
      if (aboveViewport && Math.abs(delta) > 1)
        this.#container.scrollTop += delta
    }
    requestAnimationFrame(updateHeight)
    doc.fonts?.ready?.then(updateHeight)
    for (const image of doc.images || [])
      if (!image.complete) image.addEventListener('load', updateHeight, { once: true })
    item.resizeObserver = new ResizeObserver(updateHeight)
    if (doc.body) item.resizeObserver.observe(doc.body)

    item.overlayer = new Overlayer(doc)
    wrapper.append(item.overlayer.element)
    this.#drawAnnotations(item)

    const capture = () => this.#onSelection?.(doc, index)
    doc.addEventListener('mouseup', capture)
    doc.addEventListener('selectionchange', capture)
    doc.addEventListener('click', event => {
      const [value] = item.overlayer.hitTest({ x: event.clientX, y: event.clientY })
      if (value) {
        const annotation = this.#annotations.find(entry => entry.locator === value)
        this.#onAnnotation?.(annotation)
        return
      }
      const anchor = event.target.closest?.('a[href]')
      if (!anchor) return
      event.preventDefault()
      const rawHref = anchor.getAttribute('href')
      const href = section.resolveHref?.(rawHref) ?? rawHref
      if (this.#book.isExternal?.(href) || /^(https?:|mailto:)/i.test(href))
        this.#onExternalLink?.(href)
      else this.goTo(href).catch(console.error)
    })
    this.#onDocumentLoad?.(doc, index)
  }

  #drawAnnotations(item) {
    if (!item?.overlayer || !item.doc) return
    for (const key of item.annotationKeys) item.overlayer.remove(key)
    item.annotationKeys.clear()
    for (const annotation of this.#annotations.filter(entry =>
      entry.kind === 'ebook' && (entry.section == null || entry.section === item.index))) {
      try {
        const resolved = this.#view.resolveNavigation(annotation.locator)
        if (resolved?.index !== item.index) continue
        const range = resolved.anchor?.(item.doc)
        if (range) {
          item.overlayer.add(annotation.locator, range,
            Overlayer.highlight, { color: annotation.color || '#f4c95d' })
          item.annotationKeys.add(annotation.locator)
        }
      } catch (error) {
        console.warn(error)
      }
    }
  }

  setStyles(styles) {
    this.#styles = styles
    for (const item of this.#items.values()) {
      const style = item.doc?.querySelector('style[data-quiet-reader-continuous]')
      if (!style) continue
      const suffix = style.textContent.slice(style.textContent.indexOf('\n      html {'))
      style.textContent = styles + suffix
    }
  }

  setAnnotations(annotations) {
    this.#annotations = annotations
    for (const item of this.#items.values()) {
      if (item.doc) this.#drawAnnotations(item)
    }
  }

  async goTo(target) {
    const resolved = this.#resolveTarget(target)
    await this.#scrollToResolved(resolved, true)
  }

  async goToFraction(fraction) {
    return this.goTo({ fraction })
  }

  async #scrollToResolved(resolved, smooth) {
    const index = this.#normalizeIndex(resolved?.index)
    const item = await this.#load(index)
    if (!item) return
    await this.#load(this.#adjacent(index, 1))
    let offset = 0
    const anchor = typeof resolved?.anchor === 'function'
      ? resolved.anchor(item.doc) : resolved?.anchor
    if (typeof anchor === 'number') {
      offset = clamp(anchor) * Math.max(0, item.wrapper.offsetHeight - this.#container.clientHeight)
    } else if (anchor?.getBoundingClientRect) {
      offset = anchor.getBoundingClientRect().top
    }
    this.#container.scrollTo({
      top: item.wrapper.offsetTop + Math.max(0, offset),
      behavior: smooth ? 'smooth' : 'auto',
    })
  }

  scrollByPage(direction) {
    this.#container.scrollBy({
      top: direction * this.#container.clientHeight * .88,
      behavior: 'smooth',
    })
  }

  currentLocation() {
    const index = this.currentIndex
    const item = this.#items.get(index)
    if (!item) return null
    const relativeMiddle = this.#container.scrollTop + this.#container.clientHeight / 2
      - item.wrapper.offsetTop
    const localFraction = clamp(relativeMiddle / Math.max(1, item.wrapper.offsetHeight))
    let range = null
    if (item.doc) {
      const x = Math.max(1, item.iframe.clientWidth / 2)
      const y = Math.max(1, Math.min(item.iframe.clientHeight - 1, relativeMiddle))
      range = item.doc.caretRangeFromPoint?.(x, y) || null
    }
    const fraction = interpolateSectionProgress(
      this.#view.getSectionFractions?.() || [], index, localFraction)
    const cfi = range ? this.#view.getCFI(index, range) : null
    const tocItem = this.#view.getProgressOf?.(index, range)?.tocItem
    return { index, fraction, cfi, tocItem, range, localFraction }
  }

  getCurrentDocument() {
    const index = this.currentIndex
    const item = this.#items.get(index)
    return item?.doc ? { doc: item.doc, index } : null
  }

  deselect() {
    for (const { doc } of this.#items.values())
      doc?.defaultView?.getSelection()?.removeAllRanges()
  }

  #emitRelocate() {
    const location = this.currentLocation()
    if (location) this.dispatchEvent(new CustomEvent('relocate', { detail: location }))
  }

  destroy() {
    this.#destroyed = true
    if (this.#scrollFrame != null) cancelAnimationFrame(this.#scrollFrame)
    this.#observer?.disconnect()
    for (const item of this.#items.values()) {
      item.resizeObserver?.disconnect()
      if (item.loaded) item.section.unload?.()
      item.loaded = false
    }
    this.#items.clear()
    this.#container.remove()
  }
}
