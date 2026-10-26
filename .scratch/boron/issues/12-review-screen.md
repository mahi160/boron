# 12: Review screen: side-by-side edit and re-run

**What to build:** For any page, the user sees the page image next to editable text, toggles the raw/proofread diff, saves edits, and can re-run OCR/proofread for that page or its batch. Edited pages are kept unless the user explicitly re-runs them.

**Blocked by:** 07 Proofread stage

**Status:** ready-for-agent

- [ ] Page image and text are shown side by side with page navigation
- [ ] Edits are saved and appear in the next EPUB export
- [ ] Re-running a page replaces its text only after confirmation and only for that page
- [ ] Re-run requests go through the limiter like any other request

**Context:** see `PLAN.md` at the repo root.
