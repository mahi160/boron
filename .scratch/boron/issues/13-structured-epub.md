# 13: Structured text and EPUB3 fidelity

**What to build:** Model output follows a per-page structured contract (Markdown with headings, bold/italic, footnotes, tables, verse blocks, figure placeholders, plus running header, printed page number, and ends-mid-paragraph flag). Assembly strips running headers and page numbers, joins paragraphs split across pages, and pandoc produces an EPUB3 that keeps that structure.

**Blocked by:** 03 Walking skeleton

**Status:** ready-for-agent

- [ ] Running headers and page numbers do not appear in the EPUB body
- [ ] A paragraph split across a page break appears as one paragraph
- [ ] Footnotes, tables, bold/italic, and poems (line breaks preserved) render correctly in the EPUB
- [ ] Invalid model output for a page is retried, then flagged for review instead of breaking the book

**Context:** see `PLAN.md` at the repo root.
