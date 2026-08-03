import { normalizeAnchorText } from './text-anchor.js';
const SENTENCE_BOUNDARY = /[.!?。！？]/u;
export function createSearchContext(sourceValue, matchStartValue, matchLengthValue, radius = 60) {
    const source = String(sourceValue || '');
    const matchStart = Math.max(0, Math.min(source.length, Number(matchStartValue) || 0));
    const matchLength = Math.max(0, Number(matchLengthValue) || 0);
    const matchEnd = Math.min(source.length, matchStart + matchLength);
    const previousBoundary = findPreviousBoundary(source, matchStart);
    const nextBoundary = findNextBoundary(source, matchEnd);
    let start = previousBoundary >= 0 ? previousBoundary + 1 : Math.max(0, matchStart - radius);
    let end = nextBoundary >= 0 ? nextBoundary + 1 : Math.min(source.length, matchEnd + radius);
    while (start < matchStart && /\s/u.test(source[start]))
        start += 1;
    while (end > matchEnd && /\s/u.test(source[end - 1]))
        end -= 1;
    const raw = source.slice(start, end);
    const normalized = normalizeAnchorText(raw);
    return {
        text: normalized.text,
        start,
        end,
        matchStart: normalizedIndexAtOrAfter(normalized.offsets, matchStart - start),
        matchEnd: normalizedIndexAtOrAfter(normalized.offsets, matchEnd - start),
    };
}
function findPreviousBoundary(source, before) {
    for (let index = before - 1; index >= 0; index -= 1) {
        if (SENTENCE_BOUNDARY.test(source[index]))
            return index;
    }
    return -1;
}
function findNextBoundary(source, after) {
    for (let index = after; index < source.length; index += 1) {
        if (SENTENCE_BOUNDARY.test(source[index]))
            return index;
    }
    return -1;
}
function normalizedIndexAtOrAfter(offsets, sourceOffset) {
    const index = offsets.findIndex(offset => offset >= sourceOffset);
    return index < 0 ? offsets.length : index;
}
