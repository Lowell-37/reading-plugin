export class ReaderAdapter {
  constructor({ format, goTo, goToFraction, navigate, getLocation = () => null, destroy = () => {} }) {
    if (!format || !goToFraction || !navigate) {
      throw new TypeError('ReaderAdapter requires format and navigation callbacks')
    }
    this.format = format
    this.goTo = goTo || (() => undefined)
    this.goToFraction = goToFraction
    this.navigate = navigate
    this.getLocation = getLocation
    this.destroy = destroy
  }
}

export function createEbookReaderAdapter({
  format,
  goTo,
  goToFraction,
  goLeft,
  goRight,
  getLocation,
  destroy,
}) {
  return new ReaderAdapter({
    format,
    goTo,
    goToFraction,
    navigate: direction => direction < 0 ? goLeft() : goRight(),
    getLocation,
    destroy,
  })
}

export function createPdfReaderAdapter({ goToPage, getPage, getPageCount, destroy }) {
  return new ReaderAdapter({
    format: 'pdf',
    goTo: target => goToPage(Number(target)),
    goToFraction: fraction => {
      const count = Math.max(1, Number(getPageCount()) || 1)
      return goToPage(1 + Math.max(0, Math.min(1, Number(fraction) || 0)) * (count - 1))
    },
    navigate: direction => goToPage((Number(getPage()) || 1) + direction),
    getLocation: () => {
      const page = Math.max(1, Number(getPage()) || 1)
      const count = Math.max(1, Number(getPageCount()) || 1)
      return { kind: 'pdf', page, fraction: count > 1 ? (page - 1) / (count - 1) : 1 }
    },
    destroy,
  })
}
