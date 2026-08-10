import { normalizeAnchorText } from './text-anchor.js';
const SENTENCE_BOUNDARY = /[.!?。！？]/u;
export function createSearchContext(sourceValue, matchStartValue, matchLengthValue, radius = 60) {
    const source = String(sourceValue || '');
    const matchStart = Math.max(0, Math.min(source.length, Number(matchStartValue) || 0));
    const matchLength = Math.max(0, Number(matchLengthValue) || 0);
    const matchEnd = Math.min(source.length, matchStart + matchLength);
    const previousBoundary = findPreviousBoundary(source, matchStart);
    const nextBoundary = matchEnd > matchStart && SENTENCE_BOUNDARY.test(source[matchEnd - 1])
        ? matchEnd - 1
        : findNextBoundary(source, matchEnd);
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
export function findSearchMatches(sourceValue, queryValue) {
    return [...iterateSearchMatches(sourceValue, queryValue)];
}
export function* iterateSearchMatches(sourceValue, queryValue) {
    const source = String(sourceValue ?? '');
    const query = String(queryValue ?? '');
    const foldedQuery = foldCase(query).text;
    if (!foldedQuery)
        return;
    const foldedSource = foldCase(source);
    let fromIndex = 0;
    while (fromIndex <= foldedSource.text.length - foldedQuery.length) {
        const foldedStart = foldedSource.text.indexOf(foldedQuery, fromIndex);
        if (foldedStart < 0)
            break;
        const foldedEnd = foldedStart + foldedQuery.length;
        yield {
            start: foldedSource.starts[foldedStart] ?? source.length,
            end: foldedSource.ends[foldedEnd - 1] ?? source.length,
        };
        fromIndex = foldedEnd;
    }
}
function foldCase(source) {
    const text = source.toLowerCase();
    let sourceOffset = 0;
    const starts = [];
    const ends = [];
    for (const character of source) {
        const folded = character.toLowerCase();
        const sourceEnd = sourceOffset + character.length;
        for (let index = 0; index < folded.length; index += 1) {
            starts.push(sourceOffset);
            ends.push(sourceEnd);
        }
        sourceOffset = sourceEnd;
    }
    if (starts.length !== text.length)
        return foldCaseByPrefixes(source, text);
    return { text, starts, ends };
}
function foldCaseByPrefixes(source, text) {
    const starts = [];
    const ends = [];
    let sourceOffset = 0;
    let foldedOffset = 0;
    for (const character of source) {
        const sourceEnd = sourceOffset + character.length;
        const foldedEnd = source.slice(0, sourceEnd).toLowerCase().length;
        while (foldedOffset < foldedEnd) {
            starts.push(sourceOffset);
            ends.push(sourceEnd);
            foldedOffset += 1;
        }
        sourceOffset = sourceEnd;
    }
    return { text, starts, ends };
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
