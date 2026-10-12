# WXT ebook search migration plan

1. Add failing Foliate-session tests for section text search, CFI navigation, and index invalidation on close. Extend the session port and engine with the smallest API that passes.
2. Add failing Pinia tests for result batches, replacement/cancellation, and errors. Implement the ebook-search store guarded by session generation and book ID.
3. Replace the Vue shell's legacy ebook-submit expectation with failing tests for ebook routing, result display and click navigation. Wire the tools panel and prevent old-controller handling in WXT mode.
4. Run targeted and full Vitest suites, `npm run check`, `npm run build:wxt:verify`, and relevant browser smoke. Review diff and commit/push `main` only after verified.
