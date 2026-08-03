export function normalizeAnchorText(value) {
    const source = String(value || '');
    let text = '';
    const offsets = [];
    let whitespaceStart = -1;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (/\s/u.test(character)) {
            if (text && !text.endsWith(' ') && whitespaceStart < 0)
                whitespaceStart = index;
            continue;
        }
        if (whitespaceStart >= 0) {
            text += ' ';
            offsets.push(whitespaceStart);
            whitespaceStart = -1;
        }
        text += character;
        offsets.push(index);
    }
    return { text, offsets };
}
export function createTextQuoteAnchor(source, start, end, contextLength = 48) {
    const normalized = normalizeAnchorText(source);
    const normalizedStart = normalizedIndexAtOrAfter(normalized.offsets, Math.max(0, start));
    const normalizedEnd = normalizedIndexAtOrAfter(normalized.offsets, Math.max(start, end));
    const boundedEnd = Math.min(normalizedEnd, normalizedStart + 500);
    const normalizedExact = normalized.text.slice(normalizedStart, boundedEnd).trim();
    return {
        exact: normalizedExact,
        normalizedExact,
        prefix: normalized.text.slice(Math.max(0, normalizedStart - contextLength), normalizedStart),
        suffix: normalized.text.slice(boundedEnd, boundedEnd + contextLength),
    };
}
export function resolveTextQuoteAnchor(source, anchor, preferredOffset = null) {
    const normalized = normalizeAnchorText(source);
    const needle = String(anchor?.normalizedExact || '').trim();
    if (!needle || !normalized.text)
        return null;
    if (preferredOffset != null && Number.isFinite(preferredOffset)) {
        const preferredIndex = normalizedIndexAtOrAfter(normalized.offsets, Math.max(0, preferredOffset));
        if (normalized.text.slice(preferredIndex, preferredIndex + needle.length) === needle) {
            return toSourceResolution(normalized.offsets, preferredIndex, needle.length, 'offset');
        }
    }
    const candidates = [];
    let from = 0;
    while (from <= normalized.text.length - needle.length) {
        const index = normalized.text.indexOf(needle, from);
        if (index < 0)
            break;
        const prefix = commonSuffixAt(normalized.text, index, anchor.prefix || '');
        const suffix = commonPrefixAt(normalized.text, index + needle.length, anchor.suffix || '');
        const contextSize = (anchor.prefix?.length || 0) + (anchor.suffix?.length || 0);
        const score = contextSize ? (prefix + suffix) / contextSize : 0;
        candidates.push({ index, score });
        from = index + Math.max(needle.length, 1);
    }
    if (!candidates.length)
        return null;
    if (candidates.length === 1) {
        return toSourceResolution(normalized.offsets, candidates[0].index, needle.length, 'quote');
    }
    candidates.sort((left, right) => right.score - left.score);
    if (candidates[0].score <= 0 || candidates[0].score === candidates[1].score)
        return null;
    return toSourceResolution(normalized.offsets, candidates[0].index, needle.length, 'quote');
}
function normalizedIndexAtOrAfter(offsets, sourceOffset) {
    const index = offsets.findIndex(offset => offset >= sourceOffset);
    return index < 0 ? offsets.length : index;
}
function toSourceResolution(offsets, normalizedStart, length, method) {
    const normalizedEnd = normalizedStart + length;
    return {
        start: offsets[normalizedStart],
        end: offsets[normalizedEnd - 1] + 1,
        confidence: 1,
        method,
    };
}
function commonPrefixAt(source, start, context) {
    const length = Math.min(source.length - start, context.length);
    let count = 0;
    while (count < length && source[start + count] === context[count])
        count += 1;
    return count;
}
function commonSuffixAt(source, end, context) {
    const length = Math.min(end, context.length);
    let count = 0;
    while (count < length && source[end - count - 1] === context[context.length - count - 1])
        count += 1;
    return count;
}
