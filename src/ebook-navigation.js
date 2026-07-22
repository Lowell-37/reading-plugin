const waitForRender = (view, navigate, timeout) => new Promise(resolve => {
  let timer
  const finish = rendered => {
    clearTimeout(timer)
    view.removeEventListener('relocate', onRender)
    resolve(rendered)
  }
  const onRender = () => finish(true)
  view.addEventListener('relocate', onRender, { once: true })
  timer = setTimeout(() => finish(false), timeout)
  Promise.resolve().then(navigate).catch(() => finish(false))
})

export async function initializeEbookPosition(view, progress, { timeout = 1500 } = {}) {
  const attempts = []
  if (progress?.kind === 'ebook' && progress.cfi) attempts.push(() => view.goTo(progress.cfi))
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
