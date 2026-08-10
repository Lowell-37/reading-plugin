const clamp = value => Math.max(0, Math.min(1, Number(value) || 0))

export function interpolateSectionProgress(starts, index, localFraction) {
  const count = Math.max(starts?.length || 0, index + 1)
  const start = Number(starts?.[index])
  const end = Number(starts?.[index + 1])
  const safeStart = Number.isFinite(start) ? start : index / Math.max(1, count)
  const safeEnd = Number.isFinite(end) ? end : (index + 1) / Math.max(1, count)
  return clamp(safeStart + (safeEnd - safeStart) * clamp(localFraction))
}

export function activeSectionIndex(layout, viewportMiddle) {
  if (!layout.length) return -1
  const containing = layout.find(({ top, bottom }) =>
    viewportMiddle >= top && viewportMiddle < bottom)
  if (containing) return containing.index
  return layout.reduce((closest, item) =>
    Math.abs(item.top - viewportMiddle) < Math.abs(closest.top - viewportMiddle)
      ? item : closest).index
}

export function retainedSectionIndices(indices, activeIndex, radius = 3) {
  const position = indices.indexOf(activeIndex)
  if (position < 0) return new Set()
  const safeRadius = Math.max(0, Math.floor(Number(radius) || 0))
  return new Set(indices.slice(
    Math.max(0, position - safeRadius),
    position + safeRadius + 1,
  ))
}

export { clamp }
