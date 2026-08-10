import type { EbookLocation } from './types'

interface SectionLike {
  linear?: string
}

interface EbookViewLike extends EventTarget {
  book: { sections: SectionLike[] }
  renderer: { goTo(target: { index: number }): unknown }
  goTo(cfi: string): unknown
  goToFraction(fraction: number): unknown
  goToTextStart(): unknown
}

const waitForRender = (
  view: EbookViewLike,
  navigate: () => unknown,
  timeout: number,
): Promise<boolean> => new Promise(resolve => {
  let timer: ReturnType<typeof setTimeout>
  const finish = (rendered: boolean) => {
    clearTimeout(timer)
    view.removeEventListener('relocate', onRender)
    resolve(rendered)
  }
  const onRender = () => finish(true)
  view.addEventListener('relocate', onRender, { once: true })
  timer = setTimeout(() => finish(false), timeout)
  Promise.resolve().then(navigate).catch(() => finish(false))
})

export async function initializeEbookPosition(
  view: EbookViewLike,
  progress: EbookLocation | null | undefined,
  { timeout = 1500 }: { timeout?: number } = {},
): Promise<boolean> {
  const attempts: Array<() => unknown> = []
  if (progress?.kind === 'ebook' && progress.cfi) attempts.push(() => view.goTo(progress.cfi as string))
  if (progress?.kind === 'ebook' && Number.isFinite(progress.fraction) && progress.fraction > 0) {
    attempts.push(() => view.goToFraction(progress.fraction))
  }
  attempts.push(() => view.goToTextStart())

  const firstReadableIndex = view.book.sections.findIndex(section => section.linear !== 'no')
  attempts.push(() => view.renderer.goTo({ index: firstReadableIndex < 0 ? 0 : firstReadableIndex }))

  for (const attempt of attempts) {
    if (await waitForRender(view, attempt, timeout)) return true
  }
  return false
}
