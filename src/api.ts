import { access, readFile, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Boron } from "./boron.ts";
import { assemblyPages, exportEpub, exportTranslation } from "./epub/export.ts";
import { proposeToc } from "./epub/assemble.ts";
import { EpubError, readEpub } from "./epub/source.ts";
import { cropFigure, toCoverJpeg } from "./figures.ts";
import { pageLabels } from "./page-labels.ts";
import { isObj } from "./json.ts";
import { pdfPageCount } from "./render.ts";
import { type Decision, decideSuggestions, type Figure } from "./pipeline/contract.ts";
import { testProvider } from "./provider-test.ts";
import { getSettings, parseSettings, publicSettings, saveSettings, type Settings } from "./settings.ts";
import type { Book, GlossaryEntry, Store, TocEntry } from "./store.ts";
import type { BookDetail, LibraryBook, TocResponse } from "./wire.ts";

class HttpError extends Error {
	readonly status: 400 | 403 | 404 | 409;
	constructor(status: 400 | 403 | 404 | 409, message: string) {
		super(message);
		this.status = status;
	}
}

function int(value: unknown, name: string): number {
	const n = typeof value === "string" ? Number(value) : value;
	if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new HttpError(400, `${name} must be a positive whole number`);
	return n;
}

function str(o: Record<string, unknown>, key: string, max = 500): string {
	const value = o[key];
	if (typeof value !== "string" || value.length > max) throw new HttpError(400, `${key} must be text of at most ${max} characters`);
	return value.trim();
}

function parseFigures(value: unknown): Figure[] | null {
	if (value === null) return null;
	if (!Array.isArray(value)) throw new HttpError(400, "figures must be a list or null");
	return value.map((f) => {
		if (!isObj(f) || !Array.isArray(f.bbox) || f.bbox.length !== 4) throw new HttpError(400, "each figure needs a 4-number bbox");
		const [y0 = Number.NaN, x0 = Number.NaN, y1 = Number.NaN, x1 = Number.NaN] = f.bbox.map((v) =>
			typeof v === "number" ? Math.round(v) : Number.NaN,
		);
		if (![y0, x0, y1, x1].every((v) => v >= 0 && v <= 1000) || y0 >= y1 || x0 >= x1) {
			throw new HttpError(400, "bbox values must be 0–1000 with ymin < ymax and xmin < xmax");
		}
		const bbox: Figure["bbox"] = [y0, x0, y1, x1];
		return { bbox, caption: typeof f.caption === "string" ? f.caption.slice(0, 500) : "" };
	});
}

function parseToc(value: unknown, pageCount: number): TocEntry[] | null {
	if (value === null) return null;
	if (!Array.isArray(value)) throw new HttpError(400, "toc must be a list or null");
	return value.map((e) => {
		if (!isObj(e)) throw new HttpError(400, "each toc entry must be an object");
		const id = str(e, "id", 40);
		if (!/^\d+:(\d+|split)$/.test(id)) throw new HttpError(400, `toc entry id "${id}" is not valid`);
		const page = int(e.page, "page");
		if (page > pageCount) throw new HttpError(400, `page ${page} is past the end of the book`);
		const level = e.level;
		if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 6) throw new HttpError(400, "level must be 0–6");
		return { id, page, title: str(e, "title"), level };
	});
}

function parseGlossary(value: unknown): GlossaryEntry[] {
	if (!Array.isArray(value) || value.length > 2000) throw new HttpError(400, "glossary must be a list of at most 2000 entries");
	return value.flatMap((g) => {
		if (!isObj(g)) throw new HttpError(400, "each glossary entry must be an object");
		const en = str(g, "en", 200);
		const bn = str(g, "bn", 200);
		return en === "" && bn === "" ? [] : [{ en, bn }];
	});
}

/** A sample image for the provider test: page 1 of the newest rendered book, or a drawn line of text. */
async function sampleImage(boron: Boron, store: Store): Promise<Buffer> {
	const book = store.books().find((b) => b.rendered > 0);
	if (book !== undefined) return readFile(boron.files.page(book.id, Math.min(book.rendered, 3)));
	const canvas = createCanvas(600, 200);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, 600, 200);
	ctx.fillStyle = "#000";
	ctx.font = "32px serif";
	ctx.fillText("Boron provider test 1234", 40, 110);
	return canvas.encode("jpeg", 90);
}

export function libraryEntry(store: Store, book: Book): LibraryBook {
	const pages = store.pageSummaries(book.id);
	const batches = store.batches(book.id);
	const count = (status: string) => pages.filter((p) => p.status === status).length;
	const waits = batches.flatMap((b) => (b.state === "waiting" && b.wakeAt !== null ? [b.wakeAt] : []));
	return {
		...book,
		done: count("done"),
		flagged: count("flagged"),
		failed: count("failed"),
		suggestions: pages.reduce((sum, p) => sum + p.pending, 0),
		nextWake: waits.length > 0 ? Math.min(...waits) : null,
		inputTokens: batches.reduce((sum, b) => sum + b.inputTokens, 0),
		outputTokens: batches.reduce((sum, b) => sum + b.outputTokens, 0),
	};
}

export function createApi(boron: Boron, store: Store) {
	const api = new Hono();

	// Requests that change something must come from Boron's own page: a cross-site page could otherwise
	// drive the API (and, with the stored key, the provider test) from the user's browser.
	api.use(async (c, next) => {
		if (c.req.method !== "GET" && c.req.method !== "HEAD") {
			const origin = c.req.header("origin");
			if (origin !== undefined && URL.parse(origin)?.host !== c.req.header("host")) throw new HttpError(403, "Cross-site request refused");
		}
		await next();
	});

	api.onError((error, c) => {
		if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
		console.error(error);
		return c.json({ error: "Something went wrong on the server" }, 500);
	});

	const bookOf = (id: string): Book => {
		const book = store.book(id);
		if (book === undefined) throw new HttpError(404, "No such book");
		return book;
	};
	const pageOf = (book: Book, value: string): number => {
		const page = int(value, "page");
		if (page > book.pageCount) throw new HttpError(404, "No such page");
		return page;
	};
	const body = async (c: { req: { json: () => Promise<unknown> } }) => {
		const value = await c.req.json().catch(() => undefined);
		if (!isObj(value)) throw new HttpError(400, "Expected a JSON object");
		return value;
	};
	const jpeg = (data: Uint8Array) =>
		new Response(data, { headers: { "content-type": "image/jpeg", "cache-control": "no-cache" } });

	api.get("/health", (c) => c.json({ ok: true }));

	api.get("/events", (c) =>
		streamSSE(c, async (stream) => {
			// Tell clients which book changed, at most every 300 ms per book; they refetch what they show.
			const pending = new Map<string, ReturnType<typeof setTimeout>>();
			const stop = boron.subscribe((bookId) => {
				if (pending.has(bookId)) return;
				pending.set(
					bookId,
					setTimeout(() => {
						pending.delete(bookId);
						void stream.writeSSE({ event: "book", data: bookId });
					}, 300),
				);
			});
			const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
			await new Promise<void>((resolve) => stream.onAbort(resolve));
			stop();
			clearInterval(ping);
			for (const timer of pending.values()) clearTimeout(timer);
		}),
	);

	api.get("/books", (c) => c.json(store.books().map((book) => libraryEntry(store, book))));

	api.post("/books", async (c) => {
		const form = await c.req.parseBody();
		const file = form.file;
		if (!(file instanceof File)) throw new HttpError(400, "Upload a PDF as the form field \"file\"");
		const data = new Uint8Array(await file.arrayBuffer());
		if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-") throw new HttpError(400, "That file is not a PDF");
		const pages = await pdfPageCount(data).catch(() => {
			throw new HttpError(400, "That PDF cannot be opened");
		});
		// Optional page range; empty fields mean the first and the last page.
		const bound = (name: string) => {
			const value = form[name];
			return typeof value === "string" && value.trim() !== "" ? int(value.trim(), name) : null;
		};
		const firstPage = bound("from") ?? 1;
		const lastPage = bound("to");
		if (firstPage > pages) throw new HttpError(400, `${file.name} has only ${pages} pages`);
		if (lastPage !== null && lastPage < firstPage) throw new HttpError(400, "The last page must not come before the first");
		return c.json({ id: await boron.addBook(file.name, data, { firstPage, lastPage: lastPage === null ? null : Math.min(lastPage, pages) }) }, 201);
	});

	// An English EPUB to translate to Bangla.
	api.post("/translate", async (c) => {
		const file = (await c.req.parseBody()).file;
		if (!(file instanceof File)) throw new HttpError(400, "Upload an EPUB as the form field \"file\"");
		const data = new Uint8Array(await file.arrayBuffer());
		let source: ReturnType<typeof readEpub>;
		try {
			source = readEpub(data);
		} catch (error) {
			if (error instanceof EpubError) throw new HttpError(400, error.message);
			throw error;
		}
		if (source.markdown.trim() === "") throw new HttpError(400, "That EPUB has no text to translate");
		return c.json({ id: await boron.addEpub(file.name, data, source) }, 201);
	});

	api.get("/books/:id/glossary", (c) => c.json({ glossary: bookOf(c.req.param("id")).glossary }));

	api.put("/books/:id/glossary", async (c) => {
		const book = bookOf(c.req.param("id"));
		if (book.kind !== "epub-translate") throw new HttpError(400, "Only translation books have a glossary");
		store.updateBook(book.id, { glossary: parseGlossary((await body(c)).glossary) });
		return c.json({ glossary: store.book(book.id)?.glossary ?? null });
	});

	api.get("/books/:id/images/:file", async (c) => {
		const book = bookOf(c.req.param("id"));
		const file = c.req.param("file");
		if (!/^\w[\w.-]*$/.test(file)) throw new HttpError(404, "No such image");
		const data = await readFile(boron.files.image(book.id, file)).catch(() => {
			throw new HttpError(404, "No such image");
		});
		const type = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[file.split(".").pop()?.toLowerCase() ?? ""];
		// SVG and unknown types download rather than run in the page.
		return new Response(data, { headers: { "content-type": type ?? "application/octet-stream", "cache-control": "no-cache" } });
	});

	api.get("/books/:id", async (c) => {
		const book = bookOf(c.req.param("id"));
		const now = Date.now();
		const settings = getSettings();
		const pages = store.pageSummaries(book.id);
		const labels = pageLabels(pages.map((p) => ({ page: p.page, printed: p.printed, edited: p.pageLabel })));
		return c.json({
			book: libraryEntry(store, book),
			pages: pages.map((p) => ({ ...p, label: labels.get(p.page) ?? null })),
			batches: store.batches(book.id),
			parked: (await boron.parked()).filter((p) => p.bookId === book.id),
			exhausted: settings.providers.flatMap((p) => {
				const until = store.exhaustedUntil(p.id, now);
				return until === null ? [] : [{ provider: p.id, name: p.name, until }];
			}),
		} satisfies BookDetail);
	});

	api.get("/books/:id/costs", (c) => c.json(store.bookCosts(bookOf(c.req.param("id")).id)));

	api.get("/costs", (c) => c.json(store.costs()));

	api.post("/books/:id/:action{pause|resume|abort}", async (c) => {
		const book = bookOf(c.req.param("id"));
		const action = c.req.param("action");
		if (action === "pause") await boron.pause(book.id);
		else if (action === "abort") await boron.abort(book.id);
		else if (!(await boron.resume(book.id))) throw new HttpError(409, "This book is already being read.");
		return c.json({ ok: true });
	});

	api.delete("/books/:id", async (c) => {
		await boron.remove(bookOf(c.req.param("id")).id);
		return c.json({ ok: true });
	});

	api.get("/books/:id/pages/:page", (c) => {
		const book = bookOf(c.req.param("id"));
		const row = store.page(book.id, pageOf(book, c.req.param("page")));
		if (row === undefined) throw new HttpError(404, "No such page");
		return c.json(row);
	});

	api.put("/books/:id/pages/:page", async (c) => {
		const book = bookOf(c.req.param("id"));
		const page = pageOf(book, c.req.param("page"));
		const input = await body(c);
		const markdown = input.markdown === null ? null : str(input, "markdown", 200_000);
		store.saveEdit(book.id, page, markdown);
		return c.json(store.page(book.id, page));
	});

	/** Accept or reject proofreading suggestions: `{ decisions: [{ index, find, status: "accepted" | "rejected" }] }`. */
	api.put("/books/:id/pages/:page/suggestions", async (c) => {
		const book = bookOf(c.req.param("id"));
		const page = pageOf(book, c.req.param("page"));
		const list = (await body(c)).decisions;
		if (!Array.isArray(list)) throw new HttpError(400, "decisions must be a list");
		const decisions = list.map((d): Decision => {
			const status = isObj(d) ? d.status : undefined;
			if (isObj(d) && Number.isInteger(d.index) && typeof d.find === "string" && (status === "accepted" || status === "rejected")) {
				return { index: Number(d.index), find: d.find, status };
			}
			throw new HttpError(400, "each decision needs an index, its find text and a status of accepted or rejected");
		});
		const row = store.page(book.id, page);
		if (row === undefined) throw new HttpError(404, "No such page");
		const decided = decideSuggestions(row, decisions);
		if ("error" in decided) throw new HttpError(409, decided.error);
		store.saveDecisions(book.id, page, decided.proofread, decided.suggestions, decided.edited);
		return c.json(store.page(book.id, page));
	});

	api.put("/books/:id/pages/:page/label", async (c) => {
		const book = bookOf(c.req.param("id"));
		const page = pageOf(book, c.req.param("page"));
		const input = await body(c);
		store.savePageLabel(book.id, page, input.label === null ? null : str(input, "label", 20));
		return c.json({ ok: true });
	});

	api.put("/books/:id/pages/:page/figures", async (c) => {
		const book = bookOf(c.req.param("id"));
		const page = pageOf(book, c.req.param("page"));
		store.saveFigures(book.id, page, parseFigures((await body(c)).figures));
		return c.json(store.page(book.id, page));
	});

	api.get("/books/:id/pages/:page/image", async (c) => {
		const book = bookOf(c.req.param("id"));
		return jpeg(await readFile(boron.files.page(book.id, pageOf(book, c.req.param("page")))));
	});

	api.get("/books/:id/pages/:page/figures/:index", async (c) => {
		const book = bookOf(c.req.param("id"));
		const page = pageOf(book, c.req.param("page"));
		const row = store.page(book.id, page);
		const figures = row?.figures ?? (row?.proofread ?? row?.raw)?.figures ?? [];
		const index = Number(c.req.param("index"));
		const figure = Number.isInteger(index) ? figures[index] : undefined;
		if (figure === undefined) throw new HttpError(404, "No such figure");
		return jpeg(await cropFigure(boron.files.page(book.id, page), figure.bbox));
	});

	api.post("/books/:id/rerun", async (c) => {
		const book = bookOf(c.req.param("id"));
		const pages = (await body(c)).pages;
		if (!Array.isArray(pages) || pages.length === 0 || pages.length > 20) throw new HttpError(400, "pages must list 1–20 pages");
		if (!(await boron.rerun(book.id, pages.map((p) => pageOf(book, String(p)))))) {
			throw new HttpError(409, "This book is being read. Pause it, or wait for its pages to finish, then read the page again.");
		}
		return c.json({ ok: true });
	});

	// Every page marked to check or failed, read again from scratch (their edits are dropped, as for any re-run).
	api.post("/books/:id/rerun-flagged", async (c) => {
		const book = bookOf(c.req.param("id"));
		const pages = store.pageSummaries(book.id).flatMap((p) => (p.status === "flagged" || p.status === "failed" ? [p.page] : []));
		if (pages.length === 0) throw new HttpError(400, "No pages to check or failed");
		if (!(await boron.rerun(book.id, pages))) {
			throw new HttpError(409, "This book is being read. Pause it, or wait for its pages to finish, then read the pages again.");
		}
		return c.json({ pages: pages.length });
	});

	api.get("/books/:id/toc", (c) => {
		const book = bookOf(c.req.param("id"));
		const proposed = proposeToc(assemblyPages(store.pages(book.id), false));
		return c.json({ proposed, toc: book.toc ?? proposed, edited: book.toc !== null } satisfies TocResponse);
	});

	api.put("/books/:id/toc", async (c) => {
		const book = bookOf(c.req.param("id"));
		store.updateBook(book.id, { toc: parseToc((await body(c)).toc, book.pageCount) });
		return c.json({ ok: true });
	});

	api.put("/books/:id/meta", async (c) => {
		const book = bookOf(c.req.param("id"));
		const input = await body(c);
		const cover = input.cover;
		const parsedCover =
			// A translation book has no page images to take a cover from.
			isObj(cover) && cover.kind === "page" && book.kind === "pdf-ocr"
				? { kind: "page" as const, page: pageOf(book, String(cover.page)) }
				: isObj(cover) && cover.kind === "upload" && (await access(boron.files.cover(book.id)).then(() => true, () => false))
					? { kind: "upload" as const }
					: book.cover;
		const title = str(input, "title");
		if (title === "") throw new HttpError(400, "The book needs a title");
		store.updateBook(book.id, {
			title,
			author: str(input, "author"),
			publisher: str(input, "publisher"),
			year: str(input, "year", 20),
			cover: parsedCover,
		});
		return c.json(store.book(book.id));
	});

	api.post("/books/:id/cover", async (c) => {
		const book = bookOf(c.req.param("id"));
		const file = (await c.req.parseBody()).file;
		if (!(file instanceof File)) throw new HttpError(400, "Upload an image as the form field \"file\"");
		const data = await toCoverJpeg(new Uint8Array(await file.arrayBuffer())).catch(() => {
			throw new HttpError(400, "That file is not an image Boron can read (use JPEG or PNG)");
		});
		await writeFile(boron.files.cover(book.id), data);
		store.updateBook(book.id, { cover: { kind: "upload" } });
		return c.json(store.book(book.id));
	});

	api.get("/books/:id/cover", async (c) => {
		const book = bookOf(c.req.param("id"));
		if (book.cover.kind === "none") throw new HttpError(404, "This book has no cover");
		const path = book.cover.kind === "upload" ? boron.files.cover(book.id) : boron.files.page(book.id, book.cover.page);
		return jpeg(await readFile(path));
	});

	api.get("/books/:id/epub", async (c) => {
		const book = bookOf(c.req.param("id"));
		const settings = getSettings();
		const epub =
			book.kind === "epub-translate"
				? await exportTranslation({
						book,
						pages: store.pages(book.id),
						tocDepth: settings.tocDepth,
						image: (file) => boron.files.image(book.id, file),
						uploadedCover: boron.files.cover(book.id),
					})
				: await exportEpub({
			book,
			pages: store.pages(book.id),
			tocDepth: settings.tocDepth,
			figures: settings.figures,
			pageImage: (page) => boron.files.page(book.id, page),
			uploadedCover: boron.files.cover(book.id),
		});
		const name = encodeURIComponent(`${book.title || "book"}.epub`);
		return new Response(epub, {
			headers: { "content-type": "application/epub+zip", "content-disposition": `attachment; filename*=UTF-8''${name}` },
		});
	});

	api.post("/parked/:taskId/retry", async (c) => {
		if (!(await boron.retryParked(int(c.req.param("taskId"), "task id")))) throw new HttpError(404, "That task is not parked");
		return c.json({ ok: true });
	});

	api.get("/settings", (c) => c.json(publicSettings(getSettings())));

	api.put("/settings", async (c) => {
		const parsed = parseSettings(await body(c), getSettings());
		if ("error" in parsed) throw new HttpError(400, parsed.error);
		await saveSettings(parsed);
		return c.json(publicSettings(parsed));
	});

	api.post("/providers/test", async (c) => {
		const input = await body(c);
		const stored: Settings = getSettings();
		const parsed = parseSettings({ ...stored, providers: [input.provider], stages: { ocr: [], proofread: [], assemble: [] } }, stored);
		if ("error" in parsed) throw new HttpError(400, parsed.error);
		const [provider] = parsed.providers;
		if (provider === undefined) throw new HttpError(400, "No provider to test");
		return c.json(await testProvider(provider, await sampleImage(boron, store)));
	});

	return api;
}
