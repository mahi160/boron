# 07: Proofread stage with raw vs proofread diff

**What to build:** After OCR, each batch goes through a second vision pass (page image + OCR text) that fixes OCR errors only, preserving the author's spelling, sadhu bhasha, and punctuation. Both versions are kept and the UI shows a per-page diff.

**Blocked by:** 03 Walking skeleton; 06 Settings: per-stage provider lists and prompts

**Status:** done (the CER check waits for the eval in #02)

- [x] Every page stores both raw OCR and proofread text
- [x] Per-page diff view highlights changes
- [x] Proofread can be switched off in settings, in which case the EPUB uses raw OCR
- [ ] On the eval pages, proofread CER is not worse than raw OCR CER, and old spellings (e.g. বড়ো, দিলুম) are left unchanged

**Context:** see `PLAN.md` at the repo root.
