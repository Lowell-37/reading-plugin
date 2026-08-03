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
    const exact = String(source).slice(start, end).trim();
    return {
        exact,
        normalizedExact: normalized.text.slice(normalizedStart, normalizedEnd).trim(),
        prefix: normalized.text.slice(Math.max(0, normalizedStart - contextLength), normalizedStart),
        suffix: normalized.text.slice(normalizedEnd, normalizedEnd + contextLength),
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
        const before = normalized.text.slice(0, index);
        const after = normalized.text.slice(index + needle.length);
        const prefix = commonSuffixLength(before, anchor.prefix || '');
        const suffix = commonPrefixLength(after, anchor.suffix || '');
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
function commonPrefixLength(left, right) {
    const length = Math.min(left.length, right.length);
    let count = 0;
    while (count < length && left[count] === right[count])
        count += 1;
    return count;
}
function commonSuffixLength(left, right) {
    const length = Math.min(left.length, right.length);
    let count = 0;
    while (count < length && left[left.length - count - 1] === right[right.length - count - 1])
        count += 1;
    return count;
}
