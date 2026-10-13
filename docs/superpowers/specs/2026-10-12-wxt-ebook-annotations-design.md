# WXT ebook annotation ownership

The WXT reader must support the existing local-first EPUB/MOBI/AZW3 annotation workflow without changing the `BookRecord.annotations` schema or the root extension. The existing PDF Pinia path remains untouched. AI stays hidden.

Three approaches were considered: keep a synthetic legacy ebook controller (smallest patch but two owners of the Foliate view), unify PDF and ebook annotation stores now (large regression surface), or give WXT ebooks their own Pinia store and Foliate port (chosen, matching the proven PDF boundary).

The Foliate session owns transient iframe selection, CFI creation, highlight overlays, and scrolled/paginated redraw. It exposes a small annotation port: consume a captured selection as locator/text/quote anchor; replace the active ebook annotations; and navigate to a locator. The port never writes IndexedDB. The ebook annotation store owns normalized annotations, filters, edits, selected IDs, imports/exports, per-book drafts, serialized writes, and session-generation guards. It preserves non-ebook annotations on record updates. Vue's tools panel chooses the active PDF or ebook store and prevents old WXT annotation listeners from running. Existing root listeners and code remain in place.

An imported annotation with a valid CFI is rendered. Anchor recovery in displayed content may update a CFI; any repair is persisted only for the same active record/generation. Unresolved anchors remain visible in the list but do not draw a misleading highlight. A save failure keeps the draft in memory and exposes retry. Closing or switching books must not write an old book after a new session begins.

Acceptance: unit tests cover selection/CFI, session lifecycle, save and stale writes, list operations and import/export routing; real Edge EPUB/MOBI/AZW3 tests cover create, visible highlight, edit, export/import, delete, reopen, and paginated/scrolled drawing. Full checks and root/WXT regression pass before commit/push.
