export function createAnnotation({ kind, locator = null, text, note = '', color = '#f4c95d', rects = [], page = null, section = null, }) {
    const createdAt = Date.now();
    return {
        id: `${createdAt}-${Math.random().toString(36).slice(2, 9)}`,
        kind,
        locator,
        page,
        section,
        text: String(text || '').trim().slice(0, 500),
        note: String(note || '').trim().slice(0, 2000),
        color,
        rects,
        createdAt,
    };
}
export function normalizeAnnotations(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => Boolean(item && typeof item === 'object'
        && 'id' in item && item.id
        && 'kind' in item && item.kind
        && (('locator' in item && item.locator) || ('page' in item && item.page))));
}
export function excerpt(text, query, radius = 42) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const term = String(query || '').trim();
    if (!term)
        return source.slice(0, radius * 2);
    const index = source.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if (index < 0)
        return source.slice(0, radius * 2);
    const start = Math.max(0, index - radius);
    const end = Math.min(source.length, index + term.length + radius);
    return `${start ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}
export function findTextMatches(text, query) {
    const source = String(text || '');
    const term = String(query || '').trim();
    if (!term)
        return [];
    const haystack = source.toLocaleLowerCase();
    const needle = term.toLocaleLowerCase();
    const matches = [];
    let offset = 0;
    while (offset < haystack.length) {
        const index = haystack.indexOf(needle, offset);
        if (index < 0)
            break;
        matches.push(index);
        offset = index + Math.max(needle.length, 1);
    }
    return matches;
}
