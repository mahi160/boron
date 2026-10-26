# Boron

Boron turns scanned Bangla book PDFs into proofread EPUB3 books. It is a self-hosted, single-user app.

1. **Upload a PDF.** Every page is rendered to an image. The PDF's own text layer is never used, because Bangla PDFs often carry broken or legacy (Bijoy) encodings.
2. **OCR.** A vision model reads the pages in batches.
3. **Proofread.** A second pass fixes OCR mistakes against the image. It keeps the author's spelling and sadhu bhasha as printed.
4. **Review.** Check the text beside the scan, and edit the text, chapters, illustrations, title and cover.
5. **Download** the EPUB, with the Noto Serif Bengali font embedded.

Jobs are durable, built on [pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable). They survive restarts and crashes. They respect each provider's request limits, fail over to the next provider when one runs out of quota, and wait for the daily quota reset when all have run out.

## Run with Docker

```sh
docker build -t boron .
docker run -d --name boron -p 3000:3000 -v boron-data:/data -e GEMINI_API_KEY=your-key boron
```

Or with Docker Compose, which reads `GEMINI_API_KEY` from `.env`:

```sh
docker compose up -d --build
```

Open http://localhost:3000.

- **Data.** Everything is stored in the `/data` volume: books, page images, settings and job state. Stop and start the container freely; a job that was running continues where it stopped.
- **Health.** The container's health check calls `GET /api/health`.
- **Providers.** `GEMINI_API_KEY` only seeds the first-run settings with a Gemini provider. Providers, keys, limits and prompts are edited on the Settings screen afterwards, and changes apply to the next request without a restart. Keys are stored in `/data/settings.json` and are never shown again in full.

### Ollama or another local server

In Settings, add an **Ollama** provider. Inside Docker, `localhost` is the container itself, so set the base URL to the host machine:

```
http://host.docker.internal:11434/v1
```

On Linux, also start the container with `--add-host=host.docker.internal:host-gateway`. Choose a vision model, such as `qwen2.5vl`. Any OpenAI-compatible endpoint works the same way, including vLLM, LM Studio and OpenRouter.

### Without any provider

With no provider configured, pages are read offline by Tesseract (`ben+eng`). Its quality is well below a vision model's, especially on conjuncts and vowel signs. When Tesseract stands in for a provider that is out of quota, the page is marked "Check".

## Gemini free tier: read this first

- **Training and review.** On the free tier, Google may use what you send (the page images and text) to improve its products, and human reviewers may read it. Do not upload books you are not allowed to share this way. Read Google's current Gemini API terms for what applies to your key.
- **EEA, Switzerland and the UK.** Google's terms restrict using unpaid quota in apps offered to users in these regions. Boron is meant for your own use.
- **Limits.** Free-tier limits are per project and change over time. Check yours in AI Studio, then set **Per minute** and **Per day** on the provider to match. Daily quotas reset at midnight Pacific time; the reset time is set under Settings → Daily quota reset.

## Develop

Node 24 and pnpm are required.

```sh
pnpm install
pnpm dev        # API server on :3000 (restarts on change; reads .env)
pnpm dev:web    # UI on :5173, proxying /api to :3000
pnpm test       # vitest
pnpm typecheck  # server and web
pnpm build      # web UI into dist/web, served by `pnpm start`
```

Set `BORON_DATA_DIR` to keep data somewhere other than `./data`, and `PORT` to change the port.

### Layout

| Path | What |
|---|---|
| `src/main.ts` | Entry point: opens storage, starts the HTTP server |
| `src/boron.ts` | The app without HTTP: add, pause, resume, abort, re-run, delete books |
| `src/api.ts` | Hono routes and the SSE change stream |
| `src/pipeline/` | Durable tasks (`boron.book`, `boron.batch`), limiter, error classification, prompts, output contract |
| `src/epub/` | Assembly (page joins, footnotes, figures, chapters) and EPUB3 writing |
| `src/store.ts` | App data in SQLite (`node:sqlite`) |
| `web/` | React UI |
| `PLAN.md` | Design decisions and findings |
