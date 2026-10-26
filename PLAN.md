# Boron — Bangla scanned PDF → proofread EPUB

Self-hosted, single-user app. Upload a scanned PDF (Bangla first), OCR it with a vision LLM in batches, proofread conservatively, review side-by-side, export EPUB3. Durable: survives crashes, rate limits, and daily quota resets.

## Decisions

| Topic | Decision | Why / evidence |
|---|---|---|
| Runtime | Node 24 + TypeScript | `@earendil-works/pi-durable` (v1.4.0) is TS-only |
| Orchestration | pi-durable, all-in: durable tasks + one conversation per batch-stage, task graph and agent events streamed to the UI | Checkpointed tasks, `sleepUntil`, child tasks, SQLite storage, `watch()`/`watchEvents()` |
| Models | Any OpenAI-compatible provider via pi-ai (`createProvider({ baseUrl })`), plus pi-ai's native `google` provider | Gemini (`/v1beta/openai/` or native), Ollama, vLLM, LM Studio, OpenRouter |
| Page rendering | pdf.js (`pdfjs-dist`) + `@napi-rs/canvas`, in-process | Cross-platform with no system binaries (replaces `pdftoppm`); page 20 of Gora at 2000 px long side renders in ~170 ms |
| OCR engine | Vision LLM. Tesseract `ben` (tesseract.js, WASM; model shipped in the image) as an offline fallback only | OXR tested on a real Bangla scan (Gora p.10): garbage output + repetition loop, 83 s; free API also returned a 520. Tesseract is weak on conjuncts |
| Stages | Two passes: OCR (image → text), then proofread (image + OCR text → corrected text). Each stage has its own provider list | Raw vs proofread diff kept for review |
| Proofread policy | Fix OCR errors only. Preserve the author's spelling, sadhu bhasha, and punctuation exactly | Old books (e.g. বড়ো, দিলুম) must not be modernized |
| Batch | N pages per model request (default 3) + concurrency, RPM, RPD knobs | Free tier is mostly limited by requests/day; adjacent pages give context for paragraphs crossing page breaks |
| Rate limits | One global limiter shared by all books. Ordered provider list per stage; on 429/quota move to the next; when all are exhausted, durable sleep until reset (default midnight PT, configurable), countdown in UI | Gemini limits are per project, unpublished, read from AI Studio → knobs |
| Fidelity | Headings/chapters, bold/italic, footnotes, tables, verse layout, cropped illustrations. Running headers and page numbers stripped | |
| Figures | Vision LLM returns bounding boxes; server crops; boxes adjustable in review UI | |
| Chapters/TOC | Pages tag headings; the assembly step proposes the TOC from them (no model call); user renames, re-levels, merges (level 0) and splits | A model pass adds a request per book for little gain over the tagged headings |
| EPUB | Pure JS: markdown-it (+ footnote, container) → XHTML, zipped with fflate; Noto Serif Bengali embedded | Cross-platform, no pandoc binary |
| App data | `node:sqlite` (`/data/boron.db`: books, pages, batches, limiter log); pi-durable in `/data/durable.sqlite` | Pages and edits are queried by the UI; tasks stay pi-durable's |
| Job control | Pause/abort = abort the book task (its batches abort with it); resume = a new book task that skips finished pages | Finished pages are already committed to the app DB |
| Metadata | Title/author pre-filled by the LLM from the title page, cover = page 1 render, all editable | |
| Review | Optional review UI: page image vs text side-by-side, editable, raw/proofread diff | |
| Users | Single user, no auth, library of books, global job queue | |
| UI | React + Vite SPA, Hono API, SSE for live progress | |
| Packaging | One Docker image, `/data` volume | |

## Architecture

```
React SPA ──HTTP/SSE──> Hono API ──> Harness (pi-durable, SQLite /data/durable.sqlite)
                                      ├─ boron.book task (per book): render → plan → finish
                                      │   └─ boron.batch tasks (children, gated by limiter)
                                      │        └─ child conversation per stage (ocr | proofread | metadata)
                                      └─ models: pi-ai providers from settings
App data: /data/boron.db; settings: /data/settings.json
Files: /data/books/<bookId>/{source.pdf, pages/0001.jpg, cover.jpg}
EPUB and figure crops are built on download from the current pages, edits and TOC.
```

### Pipeline (one `boron.book` task, phases checkpointed)

1. **render**: pdf.js renders every page to PNG (long side = image max side). Always ignore the PDF text layer: Bangla PDFs often carry broken or legacy (Bijoy) encodings.
2. **plan**: split pages into batches of N; create `boron.batch` child tasks; wait (`allSettled`).
3. **batch** (per batch, per stage):
   - Acquire a limiter slot for the stage's current provider; if none, `sleepUntil` the next slot.
   - Create a task-owned child conversation configured with that stage's model and instructions; submit page images (+ OCR text for proofread) with a `requestId`; wait.
   - Parse strict JSON output; on 429/quota mark that provider exhausted until reset and fail over; if the list is exhausted, sleep until reset.
   - Commit the page results to the book's documents.
4. **assemble**: join paragraphs across page breaks (`endsMidParagraph`), drop running headers/page numbers, crop figures, run the TOC pass, pre-fill metadata.
5. **epub** (on download): markdown-it renders each chapter to XHTML; the OPF, nav, cover, crops and the embedded font are zipped as EPUB3, `lang: bn`.

Re-running a single page or batch after a review edit or a setting change = a new `boron.batch` task for just those pages.

### Per-page output contract (both stages)

```json
{ "page": 12, "markdown": "...", "headings": [{"level": 1, "text": "..."}],
  "figures": [{"bbox": [0, 0, 1000, 1000], "caption": "..."}],
  "runningHeader": "...", "printedPageNumber": "১০", "endsMidParagraph": true }
```

Markdown conventions (Pandoc): `#` headings, `**`/`*`, `[^n]` footnotes, pipe/grid tables, `::: verse` fenced divs for poems, `![caption](fig-0012-1.png)` placeholders.

## Knobs (settings UI, live: read at every use)

- Providers `{name, kind: gemini | openai, baseUrl, apiKey, model, rpm, rpd, concurrency}`; per stage (ocr, proofread, assemble = title page metadata) an ordered list of them. No temperature: the Google API ignores sampling params
- Pages per request, image max side / JPEG quality
- Quota reset time + timezone (default 00:00 America/Los_Angeles)
- Proofread on/off; Tesseract fallback on/off; figure detection on/off
- Prompts (OCR, proofread, metadata) editable; the JSON output contract is appended by code
- EPUB: TOC depth

## UI screens

1. **Library**: books, status, progress, quota countdown, start/pause/abort.
2. **Book job**: live task graph (render → batches → assemble → epub), per-batch state, provider in use, retries, token usage.
3. **Review**: page image | editable text, raw-vs-proofread diff, figure boxes on the image (drag to adjust), re-run page/batch.
4. **Structure**: TOC editor, metadata, cover picker, Export EPUB.
5. **Settings**: providers, knobs, prompts, "test provider" button.

## Risks → spike first (M0)

1. **pi-durable fit (experimental API)**: pin the exact version. Prove: image input via `submit` (`UserInput` = pi-ai `UserMessage["content"]`; images expected, unverified end-to-end); task-owned child conversation from a custom `defineTask`; reading the error/reason of an `unanswered` submission well enough to tell RPM 429 from daily-quota 429; scheduler concurrency of sibling tasks; how app documents scale to ~600 pages per book.
2. **Bangla OCR quality**: build an eval from Bengali Wikisource proofread pages (scan + human transcription), measure CER per model (Gemini 3.8 Flash, 3.5 Flash-Lite, Gemma 4, an Ollama VLM, Tesseract `ben`). Test page: `গোরা-রবীন্দ্রনাথ ঠাকুর.pdf` p.20 on Commons.
3. **Bounding boxes**: Gemini box coordinate format and accuracy are unverified; check in the spike.
4. **Free tier terms**: Google may use free-tier inputs for training/human review; EEA/UK terms restrict unpaid quota in apps offered to users. Fine for personal use; document it in the README.

## Spike findings (#01, 2026-10-26)

Code (since replaced by the pipeline in `src/pipeline/`; see git history at `12c4f37`): `src/ocr-task.ts` (task `boron.ocrPage`), `src/render.ts`, `scripts/spike-ocr.ts`, `test/crash-resume.test.ts`, `test/gemini-errors.test.ts`.

**Pinned exactly:** `@earendil-works/pi-durable` 1.4.0, `@earendil-works/pi-ai` 1.4.0, `@earendil-works/chord` 1.4.0, `pdfjs-dist` 5.4.149, `@napi-rs/canvas` 0.1.80.

**Result:** Gora p.20 (printed ১০) OCR'd by `gemini-3.5-flash` in ~5 s, 1174 input + 379 output tokens, text stored in `data/spike.sqlite` (task outcome + the child conversation's answer entry). Reading the output by eye it matches the scan, with the line breaks kept. Page 21 has one error: `প্রতিৰনমস্কার` uses Assamese `ৰ` where the scan has `র`. The eval (#02) should count such script-confusion errors. `gemini-3.8-flash` returned 503 "high demand" on every attempt at the time.

**Images in a submission:** `UserInput` is pi-ai `UserMessage["content"]`, so pass `[{ type: "text", text }, { type: "image", data: <base64>, mimeType: "image/png" }]`. It works end to end with Gemini. The base64 image is stored in the transcript entry (~1 MB per page as PNG at 2000 px), which matters for ~600-page books. Consider JPEG, or storing a smaller image.

**Task-owned conversation from a custom task:** use two phases.
1. `open`: in `runtime.commit`, reuse `tx.scanConversations({ ownerTaskId })` or `tx.createConversation({ ownership: { kind: "task", taskId } })`, then call `configure(tx, id, { model, extensions: [], instructions })` (no tools or sections). Checkpoint the conversation ID.
2. `ocr`: `runtime.conversation(id).submit({ type: "input", requestId: "ocr:<taskId>", content })`, `wait()`, then read the answer with `tx.entry(AssistantEntry, settled.answer)` and commit the terminal outcome. The child starts as a copy of the owner conversation's agent, so `configure` must override it.

**Crash/resume:** a phase reruns from the top after a crash. The same `requestId` returns the existing submission, and the generation task resumes.
- The input is admitted once, but the provider request is sent again: the killed request's spend is lost, and it can count against quota. Budget for one extra request per crash in the limiter.
- `test/crash-resume.test.ts` SIGKILLs a process while its model request is in flight. On reopen, the task completes, the resent request carries exactly one user message, the child has one `pi.user` entry, and the submission for `ocr:<taskId>` is `done`.
- Live: `kill -9` about 2.5 s into the p.21 request, then a rerun. The rerun printed `reusing task 34 (pending)`, and the child had one submission for `ocr:34` and one user entry. Whether the request was already in flight at the kill is inconclusive; the test above is the proof.
- An `unanswered` submission (429, or a 503 after retries) ends the OcrPage task `failed`, which is terminal. Failover and sleep (#09) must happen before the task commits a failure, not by resuming it.

**What an `unanswered` submission exposes:** `{ status: "unanswered", reason: "model_error", detail: <pi-ai errorMessage string> }`.
- Gemini's streaming endpoint sends errors without a JSON content type, so `@google/genai` nests the body as a string: `{"error":{"message":"<pretty-printed Gemini JSON>","code":429,"status":"Too Many Requests"}}`. Parse it twice.
- The inner body has `details[]` containing a `google.rpc.QuotaFailure` and a `google.rpc.RetryInfo`. QuotaFailure gives `violations[].quotaId`: `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` for a per-minute 429, or the `...PerDay...` form for a daily one; it also gives `quotaValue` (the limit). RetryInfo gives `retryDelay`. Classify on `quotaId`.
- The per-minute body was captured live from a free-tier burst (`gemini-3.5-flash-lite`, limit 15 RPM). **The daily-quota 429 is assumed, unverified:** it was not captured live, and the test's daily body is the per-minute body with the `...PerDay...` `quotaId` and description swapped in. Capture a real one before #09 relies on it.
- The 429 text contains "Quota exceeded", which pi-ai classifies as non-retryable. pi-durable therefore settles a Gemini 429 at once without retrying (one request), and failover/sleep stays ours (#09).
- A 503 "high demand" is retried by pi-durable (default `retry`: 3 retries, 2 s base backoff) before it settles `unanswered` (four requests in total).
- These cases are locked in `test/gemini-errors.test.ts` against a stub that replays the captured bodies.

**Sibling concurrency:** sibling tasks run concurrently: 10 of 10 OCR tasks had their model requests in flight at once (`test/ocr-task.test.ts`). No concurrency setting exists in `HarnessSettings`, and no cap was hit. The global limiter (#08) must gate requests itself.

**Not tested:** how app documents scale to ~600 pages (Risk 1). The only data point is the transcript size: entries of 1.0 to 1.2 MB per page image in `data/spike.sqlite`.

**Usage:** `harness.usage()` reports tokens and cost per `provider/model`, so the UI can show spend without extra bookkeeping.

## Build findings (tickets 03–17, 2026-10-26)

- **Blank pages:** asked for two pages where the second was blank, `gemini-3.5-flash` returned only the first, three times, so both pages were flagged. The output contract now asks for one object per image, blank pages included; with it the same pair passed on the first try.
- **Request time:** `gemini-3.5-flash` took 27–58 s per 2–3 page request, with 2.8k–4.6k reasoning tokens of 3.3k–5.3k output tokens.
- **Errors shown to the user:** the nested Gemini error string is reduced to `<code>: <message>` (`errorMessage` in `src/pipeline/errors.ts`) before it is shown on a batch.
- **Restart coverage:** `test/pipeline.test.ts` closes and reopens the harness mid-request (graceful). The SIGKILL test from the spike is gone with the spike code.
- **Tesseract (tesseract.js 7, `ben`):** ~1.5 s per page; reads the plain text but confuses vowel signs (`লিথিয়!` for `লিখিয়া`), so its pages are flagged to check when it stands in for a model.

## Milestones

- **M0 Spike**: pi-durable + Gemini on 5 pages; eval harness with CER; decide default models/prompts.
- **M1 Core pipeline** (headless): render, batch OCR, proofread, assemble, pandoc EPUB; CLI entry.
- **M2 Durability**: limiter, provider failover, quota sleep, crash/resume tests, global queue.
- **M3 UI**: library, job view via SSE, settings.
- **M4 Review**: side-by-side editor, diff, figure boxes, TOC/metadata editor, re-run page.
- **M5 Docker**: single image, `/data` volume, `host.docker.internal` for Ollama, healthcheck, README.

## Open questions (later)

- Default page DPI vs token cost (300 vs 200) — settle from the M0 eval.
- Whether the proofread stage needs a book-level glossary (character names, recurring terms) carried across batches.
