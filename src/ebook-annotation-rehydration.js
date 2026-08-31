export function createEbookAnnotationRehydrator({ repair, hydrate, onError = console.error }) {
  const repairs = new Map()

  return {
    onLoad(doc, index) {
      const pending = Promise.resolve().then(() => repair(doc, index))
      repairs.set(index, pending)
      pending.catch(onError)
      return pending
    },
    onOverlay(index) {
      const pending = repairs.get(index) || Promise.resolve()
      return pending
        .catch(onError)
        .then(() => hydrate(index))
    },
  }
}
