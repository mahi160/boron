# 17: Tesseract fallback engine

**What to build:** Tesseract with Bangla data can serve as the OCR engine when no model provider is configured, or as the last entry in the OCR provider list when all model providers are exhausted. Pages processed this way are marked so the user can re-run them later with a model.

**Blocked by:** 06 Settings: per-stage provider lists and prompts; 09 Provider failover and quota sleep

**Status:** ready-for-agent

- [ ] With no providers configured, a book still produces an EPUB via Tesseract
- [ ] As the last OCR fallback, Tesseract handles batches only when all model providers are exhausted and the setting allows it
- [ ] Tesseract-processed pages are labelled in the review screen and can be re-run with a model

**Context:** see `PLAN.md` at the repo root.
