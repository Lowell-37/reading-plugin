import type { TextQuoteAnchor } from './types.js'
import {
  createTextQuoteAnchor,
  resolveChangedTextQuoteAnchor,
  resolveTextQuoteAnchor,
} from './text-anchor.js'

export interface AnchorRecoveryCandidate<Location> {
  location: Location
  text: string
  preferredOffset: number | null
}

export interface RecoveredAnchor<Location> {
  location: Location
  start: number
  end: number
  confidence: number
  method: 'offset' | 'quote' | 'fuzzy'
  quote: TextQuoteAnchor
}

export interface AnchorRecoveryOptions {
  minimumConfidence?: number
  minimumLead?: number
  searchRadius?: number
}

export function recoverTextAnchor<Location>(
  anchor: TextQuoteAnchor,
  candidates: AnchorRecoveryCandidate<Location>[],
  options: AnchorRecoveryOptions = {},
): RecoveredAnchor<Location> | null {
  if (!candidates.length) return null
  const origin = candidates[0]!
  const originExact = resolveTextQuoteAnchor(origin.text, anchor, origin.preferredOffset)
  if (originExact) return recovered(origin, originExact, anchor)

  const nearbyExact = candidates.slice(1).flatMap(candidate => {
    const resolution = resolveTextQuoteAnchor(candidate.text, anchor, candidate.preferredOffset)
    return resolution ? [{ candidate, resolution }] : []
  })
  if (nearbyExact.length === 1) {
    return recovered(nearbyExact[0]!.candidate, nearbyExact[0]!.resolution, anchor)
  }
  if (nearbyExact.length > 1) return null

  const matches = candidates.flatMap(candidate => {
    const resolution = resolveChangedTextQuoteAnchor(
      candidate.text,
      anchor,
      candidate.preferredOffset,
      options,
    )
    return resolution?.method === 'fuzzy' ? [{ candidate, resolution }] : []
  }).sort((left, right) => right.resolution.confidence - left.resolution.confidence)
  if (!matches.length) return null
  const minimumConfidence = options.minimumConfidence ?? 0.86
  const minimumLead = options.minimumLead ?? 0.08
  const winner = matches[0]!
  const runnerUp = matches[1]
  if (winner.resolution.confidence < minimumConfidence
    || (runnerUp && winner.resolution.confidence - runnerUp.resolution.confidence < minimumLead)) return null
  return recovered(winner.candidate, winner.resolution, anchor)
}

function recovered<Location>(
  candidate: AnchorRecoveryCandidate<Location>,
  resolution: { start: number, end: number, confidence: number, method: 'offset' | 'quote' | 'fuzzy' },
  original: TextQuoteAnchor,
): RecoveredAnchor<Location> {
  const quote = resolution.method === 'fuzzy'
    ? createTextQuoteAnchor(candidate.text, resolution.start, resolution.end)
    : original
  return {
    location: candidate.location,
    ...resolution,
    quote,
  }
}
