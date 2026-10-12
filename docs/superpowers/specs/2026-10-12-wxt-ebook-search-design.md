# WXT ebook search ownership

The root extension stays unchanged. In the WXT reader, the Foliate ebook session owns the opened `View`, so it must also own the book-section search index. The Vue tools panel owns search input, loading/error/result presentation, and navigation. The legacy controller must not handle WXT ebook search submissions.

The session constructs an `EbookSearchIndex` after a successful open using Foliate sections, document text, text-offset ranges, and CFIs. Search accepts an abort signal and emits batches; closing or replacing the book clears the index. A Pinia search store guards results by ebook session generation and book ID, aborts superseded searches, and exposes a maximum of 300 ordered results. The tools panel routes form submission to the matching PDF or ebook store, renders the matching results, and clears state when the active book changes. Empty queries clear results. Search failures remain scoped to search rather than making the reading session fail.

Verification: unit tests for Foliate index/locator and cancellation, Pinia stale-result protection, Vue form routing/results/navigation; then full tests, typechecks, WXT build, and browser smoke where available.
