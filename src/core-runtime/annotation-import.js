import { normalizeAnnotations } from './annotations.js';
export function parseAnnotationImport(source) {
    let value;
    try {
        value = JSON.parse(source);
    }
    catch {
        throw new Error('批注文件不是有效的 JSON');
    }
    if (!value || typeof value !== 'object')
        throw new Error('批注文件结构无效');
    const document = value;
    if (document.format !== 'quiet-reader-annotations')
        throw new Error('不是静读批注文件');
    if (document.version !== 1)
        throw new Error('不支持此批注文件版本');
    if (!document.book || typeof document.book !== 'object')
        throw new Error('批注文件缺少书籍信息');
    if (!Array.isArray(document.annotations))
        throw new Error('批注文件缺少批注列表');
    if (document.annotations.length > 10_000)
        throw new Error('批注文件记录过多');
    const annotations = normalizeAnnotations(document.annotations);
    if (annotations.length !== document.annotations.length)
        throw new Error('批注文件包含无效记录');
    const book = document.book;
    return {
        format: 'quiet-reader-annotations',
        version: 1,
        exportedAt: String(document.exportedAt || ''),
        book: {
            title: clean(book.title),
            author: clean(book.author),
            fileName: clean(book.fileName),
            format: clean(book.format),
        },
        annotations,
    };
}
export function annotationImportMatchesBook(imported, current) {
    const importedFormat = clean(imported.format).toLocaleLowerCase();
    const currentFormat = clean(current.format).toLocaleLowerCase();
    const importedName = clean(imported.fileName).toLocaleLowerCase();
    const currentName = clean(current.fileName).toLocaleLowerCase();
    if (importedFormat && currentFormat && importedFormat !== currentFormat)
        return false;
    if (importedName && currentName && importedName !== currentName)
        return false;
    return true;
}
export function mergeAnnotationImports(existingValue, importedValue) {
    const existing = normalizeAnnotations(existingValue);
    const imported = normalizeAnnotations(importedValue);
    const result = [...existing];
    const indexes = new Map(result.map((annotation, index) => [annotation.id, index]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const annotation of imported) {
        const index = indexes.get(annotation.id);
        if (index == null) {
            indexes.set(annotation.id, result.length);
            result.push(annotation);
            added += 1;
            continue;
        }
        const local = result[index];
        const localTime = local.updatedAt ?? local.createdAt;
        const importedTime = annotation.updatedAt ?? annotation.createdAt;
        if (importedTime > localTime) {
            result[index] = annotation;
            updated += 1;
        }
        else {
            skipped += 1;
        }
    }
    return { annotations: result, added, updated, skipped };
}
function clean(value) {
    return String(value || '').trim();
}
