export function normalizeAnnotationTags(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[,，]/);
    const tags = source
        .map(tag => String(tag || '').trim().slice(0, 30))
        .filter(Boolean);
    return [...new Set(tags)].slice(0, 10);
}
export function createAnnotation({ kind, locator = null, text, note = '', color = '#f4c95d', rects = [], page = null, section = null, tags = [], }) {
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
        tags: normalizeAnnotationTags(tags),
    };
}
export function normalizeAnnotations(value) {
    if (!Array.isArray(value))
        return [];
    const result = [];
    for (const valueItem of value) {
        if (!valueItem || typeof valueItem !== 'object')
            continue;
        const item = valueItem;
        const kind = item.kind === 'pdf' || item.kind === 'ebook' ? item.kind : null;
        const id = String(item.id || '').trim();
        const page = finiteNumber(item.page);
        const locator = typeof item.locator === 'string' && item.locator ? item.locator : null;
        if (!id || !kind || (kind === 'pdf' ? page == null || page < 1 : !locator))
            continue;
        const createdAt = finiteNumber(item.createdAt) ?? 0;
        const updatedAt = finiteNumber(item.updatedAt);
        result.push({
            id,
            kind,
            locator,
            page,
            section: finiteNumber(item.section),
            text: String(item.text || '').trim().slice(0, 500),
            note: String(item.note || '').trim().slice(0, 2000),
            color: String(item.color || '#f4c95d'),
            rects: normalizeRects(item.rects),
            createdAt,
            ...(updatedAt == null ? {} : { updatedAt }),
            tags: normalizeAnnotationTags(item.tags),
        });
    }
    return result;
}
export function updateAnnotation(value, id, changes, now = Date.now()) {
    return value.map(annotation => annotation.id === id
        ? {
            ...annotation,
            note: changes.note === undefined
                ? annotation.note
                : String(changes.note || '').trim().slice(0, 2000),
            tags: changes.tags === undefined
                ? normalizeAnnotationTags(annotation.tags)
                : normalizeAnnotationTags(changes.tags),
            updatedAt: now,
        }
        : annotation);
}
export function filterAnnotations(value, { query = '', type = 'all' } = {}) {
    const term = String(query).trim().toLocaleLowerCase();
    return value.filter(annotation => {
        const hasNote = Boolean(String(annotation.note || '').trim());
        if (type === 'notes' && !hasNote)
            return false;
        if (type === 'highlights' && hasNote)
            return false;
        if (type === 'pdf' && annotation.kind !== 'pdf')
            return false;
        if (type === 'ebook' && annotation.kind !== 'ebook')
            return false;
        if (!term)
            return true;
        const location = annotation.kind === 'pdf' ? `第 ${annotation.page || ''} 页` : '电子书';
        return [annotation.text, annotation.note, annotation.tags?.join(' '), location]
            .some(field => String(field || '').toLocaleLowerCase().includes(term));
    });
}
export function sortAnnotations(value, sort = 'newest') {
    return [...value].sort((left, right) => {
        if (sort === 'location') {
            const leftLocation = left.kind === 'pdf' ? left.page ?? Number.MAX_SAFE_INTEGER : left.section ?? Number.MAX_SAFE_INTEGER;
            const rightLocation = right.kind === 'pdf' ? right.page ?? Number.MAX_SAFE_INTEGER : right.section ?? Number.MAX_SAFE_INTEGER;
            return leftLocation - rightLocation || left.createdAt - right.createdAt;
        }
        const leftTime = left.updatedAt ?? left.createdAt;
        const rightTime = right.updatedAt ?? right.createdAt;
        return sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
    });
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
function finiteNumber(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
function normalizeRects(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap(rect => {
        if (!rect || typeof rect !== 'object')
            return [];
        const source = rect;
        const left = finiteNumber(source.left);
        const top = finiteNumber(source.top);
        const width = finiteNumber(source.width);
        const height = finiteNumber(source.height);
        return left == null || top == null || width == null || height == null
            ? []
            : [{ left, top, width, height }];
    });
}
