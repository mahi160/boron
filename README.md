# Boron

Boron turns scanned Bangla book PDFs into proofread EPUB3 books. It is a self-hosted, single-user app.

1. **Upload a PDF.** Every page is rendered to an image. The PDF's own text layer is never used, because Bangla PDFs often carry broken or legacy (Bijoy) encodings.
2. **OCR.** A vision model reads the pages in batches.
3. **Proofread.** A second pass fixes OCR mistakes against the image. It keeps the author's spelling and sadhu bhasha as printed.
4. **Review.** Check the text beside the scan, and edit the text, chapters, illustrations, title and cover.
5. **Download** the EPUB, with the Noto Serif Bengali font embedded.

Boron also translates English EPUBs into Bangla EPUBs, on the **Translate** screen. The book is split into chunks of about 3,000 words (Settings → Translation; a paragraph is never split). One request first makes a glossary of names and terms. Each chunk is then translated in order into modern standard Bangla (cholito bhasha), with the previous chunk's translation as context, and a polish pass checks the draft against the English. Headings, bold, italic and images are kept; footnotes are not handled yet. Translation uses the providers of the **Proofread and translate** stage. You can edit the glossary, the title, author and cover, and each chunk beside its English, and translate chosen chunks again.

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
- **Health.** The container's health check calls `GET /api/health`. Its answer lists which tools' logins were detected (`pi`, `Claude Code`, `Codex`), never a token.
- **Providers.** `GEMINI_API_KEY` only seeds the first-run settings with a Gemini provider, which talks to Gemini's OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`). Every manually added provider is OpenAI-compatible; Gemini providers saved by older versions load as one automatically, keeping their key, model, limits and stage order. Providers, keys, limits and prompts are edited on the Settings screen afterwards, and changes apply to the next request without a restart. Keys are stored in `/data/settings.json` and are never shown again in full.

### Subscription logins (pi, Claude Code, Codex)

Boron can borrow a Claude or ChatGPT subscription login that another tool on the same machine already holds. Settings → **Detected logins** lists every one it finds (press **Rescan** after signing in); **Add** turns one into a provider, offering only models that read images. Requests run with thinking off.

| Source | File | Logins |
| --- | --- | --- |
| [pi](https://pi.dev) | `~/.pi/agent/auth.json` (`BORON_PI_AUTH`) | Claude, ChatGPT |
| Claude Code (Linux) | `~/.claude/.credentials.json` (`BORON_CLAUDE_CREDENTIALS`) | Claude. On macOS Claude Code keeps it in the Keychain, which Boron cannot read. |
| Codex | `~/.codex/auth.json` (`BORON_CODEX_AUTH`) | ChatGPT; a file holding only an `OPENAI_API_KEY` is offered as an OpenAI API key |

Boron refreshes a token only when it is about to expire and re-reads the file right before writing it back. For pi it also takes pi's own lock file, so the two never refresh at once. Claude Code and Codex do not take that lock: if one of them refreshes at the same moment as Boron, one side may have to sign in again. It never logs out or deletes a login; if requests fail with an auth error, sign in again in that tool.

**Terms of service.** Using a subscription login from another app may not be allowed by your plan's terms (Anthropic's for Claude, OpenAI's for ChatGPT). Check them before you use it, and accept the risk to your account. Requests count against your plan's usage limits, so set **Per minute** and **Per day** to keep Boron from using all of it.

In Docker, mount the folders you have read-write under `/logins` (the image points the variables above there; a folder that is not mounted is simply not detected):

```sh
docker run ... -v ~/.pi/agent:/logins/pi -v ~/.claude:/logins/claude -v ~/.codex:/logins/codex boron
```

With Compose, uncomment the matching lines in `compose.yaml`. Boron rewrites the existing files in place, so they keep their owner and permissions on the host; do not mount a folder that does not exist yet, or Docker creates it owned by root.

### Ollama or another local server

Boron looks for Ollama on its default port (`http://localhost:11434`, then `http://host.docker.internal:11434`; set `BORON_OLLAMA_URL` to override). When it answers, Settings → Detected logins offers it with its pulled vision models, and the provider's model is picked from a list. Otherwise, add an **Ollama** provider by hand. Inside Docker, `localhost` is the container itself, so set the base URL to the host machine:

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
| `src/epub/` | Assembly (page joins, footnotes, figures, chapters), EPUB3 writing, and reading EPUBs to translate (`source.ts`) |
| `src/store.ts` | App data in SQLite (`node:sqlite`) |
| `web/` | React UI |
| `PLAN.md` | Design decisions and findings |
