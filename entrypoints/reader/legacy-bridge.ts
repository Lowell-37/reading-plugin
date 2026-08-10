import type { Pinia } from 'pinia'
import { useReaderStore } from './stores/reader'

export function connectLegacyReaderState(pinia: Pinia): () => void {
  const store = useReaderStore(pinia)
  const sync = () => store.syncFromDom()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
    attributeFilter: ['class', 'value'],
  })
  document.addEventListener('input', sync)
  sync()
  return () => {
    observer.disconnect()
    document.removeEventListener('input', sync)
  }
}
