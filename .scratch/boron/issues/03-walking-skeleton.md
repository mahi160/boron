# 03: Walking skeleton: upload PDF → batched OCR → EPUB download

**What to build:** The thinnest complete path through every layer: in the React UI the user uploads a PDF, the server renders all pages, a durable book job OCRs them in batches of N pages per request with one configured provider, the user sees each page's text, and downloads a plain EPUB built with pandoc (Bangla language, embedded Bangla font).

**Blocked by:** 01 Spike: one page PDF→OCR through pi-durable

**Status:** done (EPUB is written in JS, not pandoc; the EPUB structure is checked in `test/epub.test.ts`, but it has not been opened in a reader yet)

- [ ] Uploading a multi-page scanned Bangla PDF produces a downloadable EPUB that opens in an EPUB reader with correct Bangla rendering
- [x] The PDF text layer is never used; pages are always rendered to images
- [x] Pages-per-request is configurable and respected
- [x] Restarting the server mid-job continues the job without redoing finished batches
- [x] Each page's OCR text is viewable in the UI

**Context:** see `PLAN.md` at the repo root.
