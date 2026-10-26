# 01: Spike: one page PDF→OCR through pi-durable

**What to build:** A headless script proves the core bet: a pinned `@earendil-works/pi-durable` Harness on SQLite runs a custom durable task that renders one PDF page, creates a task-owned child conversation configured with a Gemini vision model, submits the page image, and stores the returned Bangla text. Findings are written up in the plan so later tickets can rely on them.

**Blocked by:** None (can start immediately)

**Status:** done (findings in `PLAN.md` → Spike findings)

- [x] Running the script on the Gora sample (Wikimedia Commons `গোরা-রবীন্দ্রনাথ ঠাকুর.pdf`, page 20) stores Bangla text for that page in the SQLite file
- [x] Killing the process mid-request and rerunning resumes the same task and does not submit twice (same `requestId`)
- [x] The write-up records: how images are passed in a submission, how a task-owned conversation is created from a custom task, what an `unanswered` submission exposes for a per-minute 429 vs a daily-quota 429, and whether sibling tasks run concurrently
- [x] pi-durable and pi-ai versions are pinned exactly

**Context:** see `PLAN.md` at the repo root.
