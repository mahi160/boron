# 02: OCR eval harness with CER against Wikisource

**What to build:** A repeatable eval measures Bangla OCR quality: a small set of scanned pages with human-proofread transcriptions from Bengali Wikisource, run through each candidate engine, scored by character error rate. Its results choose the default models, render DPI, and OCR prompt.

**Blocked by:** 01 Spike: one page PDF→OCR through pi-durable

**Status:** ready-for-agent

- [ ] At least 20 pages from at least 3 books (old and modern typefaces) with ground-truth text are collected, with their source recorded
- [ ] One command scores any configured provider/model and Tesseract `ben`, reporting CER per page and overall, plus requests and tokens used
- [ ] Results for Gemini Flash variants, a Gemma model, one local Ollama vision model, and Tesseract are recorded in the plan
- [ ] Default OCR model, DPI, and prompt are chosen and recorded with the numbers that justify them

**Context:** see `PLAN.md` at the repo root.
