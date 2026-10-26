import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TaskId } from "@earendil-works/pi-durable";
import type { Figure, PageResult, Suggestion } from "./pipeline/contract.ts";

/** App data: books, pages, batches, limiter log. pi-durable keeps its own database for tasks. */

/** `pdf-ocr`: a scanned PDF read by OCR. `epub-translate`: an English EPUB translated to Bangla in chunks, one chunk per page row. */
export type BookKind = "pdf-ocr" | "epub-translate";
export type BookStatus = "rendering" | "running" | "paused" | "aborted" | "ready" | "failed";
/** `upload`: cover.jpg in the book's folder (uploaded, or taken from the source EPUB). `none`: an EPUB without a cover. */
export type Cover = { kind: "page"; page: number } | { kind: "upload" } | { kind: "none" };
/** A name or term and the Bangla form every translated chunk uses for it. */
export type GlossaryEntry = { en: string; bn: string };
/** One chapter entry. `id` is `<page>:<heading index>` for a tagged heading or `<page>:split` for an inserted one. */
export type TocEntry = { id: string; page: number; title: string; level: number };

export type Book = {
	id: string;
	kind: BookKind;
	fileName: string;
	title: string;
	author: string;
	publisher: string;
	year: string;
	/** Pages of the book: the PDF pages from `firstPage` to `lastPage`, renumbered from 1. */
	pageCount: number;
	/** The PDF pages the user chose to read; `lastPage` null = to the end. */
	firstPage: number;
	lastPage: number | null;
	/** Pages rendered to images so far. */
	rendered: number;
	status: BookStatus;
	/** The book's current or last job (a pi-durable `boron.book` task). */
	taskId: TaskId | null;
	cover: Cover;
	toc: TocEntry[] | null;
	/** Translation glossary; null until the glossary pass has run. */
	glossary: GlossaryEntry[] | null;
	error: string | null;
	createdAt: number;
};

export type PageStatus = "pending" | "done" | "flagged" | "failed";

export type PageRow = {
	bookId: string;
	page: number;
	status: PageStatus;
	/** Translation books: the chunk's English Markdown. */
	source: string | null;
	/** OCR text, or a chunk's draft translation. */
	raw: PageResult | null;
	/** Proofread text, or a chunk's polished translation. */
	proofread: PageResult | null;
	/** Proofreading corrections the proofread text was made from; spelling-like ones wait for a person. */
	suggestions: Suggestion[] | null;
	/** User-edited markdown; wins over model output until the page is re-run. */
	edited: string | null;
	/** User-adjusted figure boxes; win over model output. */
	figures: Figure[] | null;
	/** `provider/model` or `tesseract`. */
	engine: string | null;
	flag: string | null;
	/** User-set printed page label; "" = the page has none, null = use what the model read. */
	pageLabel: string | null;
};

export type BatchState = "queued" | "running" | "waiting" | "retrying" | "done" | "failed" | "aborted";

export type BatchRow = {
	id: number;
	bookId: string;
	pages: number[];
	/** `translate`: one chunk of a translation book. `glossary`: the book's glossary pass. */
	job: "pages" | "metadata" | "translate" | "glossary";
	taskId: TaskId | null;
	state: BatchState;
	stage: string | null;
	provider: string | null;
	/** When a waiting or retrying batch runs again (epoch ms). */
	wakeAt: number | null;
	note: string | null;
	inputTokens: number;
	outputTokens: number;
	updatedAt: number;
};

/** A page without its text, for lists and counts. */
export type PageSummary = {
	page: number;
	status: PageStatus;
	engine: string | null;
	flag: string | null;
	edited: boolean;
	proofread: boolean;
	/** Proofreading suggestions still waiting for a decision. */
	pending: number;
	/** Printed page number the model read, "" if none. */
	printed: string;
	pageLabel: string | null;
};

/** Requests, tokens and USD cost of a group of usage rows. */
export type CostTotals = { requests: number; inputTokens: number; outputTokens: number; cost: number };
export type CostByModel = CostTotals & { provider: string; model: string };
export type CostByStage = CostByModel & { stage: string };
export type CostByBook = CostTotals & { bookId: string; title: string; deleted: boolean };

/** A task pi-durable set aside after it crashed the process repeatedly. */
export type Parked = { taskId: TaskId; batchId: number | null; bookId: string | null; reason: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
	id TEXT PRIMARY KEY, file_name TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '',
	publisher TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '', page_count INTEGER NOT NULL DEFAULT 0,
	rendered INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL CHECK (status IN ('rendering', 'running', 'paused', 'aborted', 'ready', 'failed')),
	task_id INTEGER, cover TEXT NOT NULL, toc TEXT, error TEXT, created_at INTEGER NOT NULL,
	first_page INTEGER NOT NULL DEFAULT 1, last_page INTEGER
);
CREATE TABLE IF NOT EXISTS pages (
	book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, page INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'flagged', 'failed')), raw TEXT, proofread TEXT, edited TEXT, figures TEXT, engine TEXT, flag TEXT, page_label TEXT, PRIMARY KEY (book_id, page)
);
CREATE TABLE IF NOT EXISTS batches (
	id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
	pages TEXT NOT NULL, job TEXT NOT NULL CHECK (job IN ('pages', 'metadata', 'translate', 'glossary')),
	-- The book task that planned this batch; null for a re-run started from the review screen.
	owner INTEGER, task_id INTEGER,
	state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting', 'retrying', 'done', 'failed', 'aborted')), stage TEXT, provider TEXT, wake_at INTEGER, note TEXT,
	input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS batches_book ON batches(book_id);
-- One row per answered model request, priced when it was made. Kept when its book is deleted, for the costs screen.
CREATE TABLE IF NOT EXISTS usage (
	book_id TEXT NOT NULL, book_title TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, stage TEXT NOT NULL,
	input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost REAL NOT NULL, at INTEGER NOT NULL,
	-- The request's conversation: a phase replayed after a crash logs the same answer once.
	request TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS usage_book ON usage(book_id);
CREATE TABLE IF NOT EXISTS requests (provider TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS requests_provider_at ON requests(provider, at);
CREATE TABLE IF NOT EXISTS exhausted (provider TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT NOT NULL);
`;

type Row = Record<string, unknown>;

// Columns hold only what this module wrote; the CHECK constraints above guarantee the enum casts.
const json = <T>(value: unknown): T | null => (typeof value === "string" ? (JSON.parse(value) as T) : null);
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value));
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));
// Task ids are only written from pi-durable's TaskId values.
const taskIdOrNull = (value: unknown): TaskId | null => numOrNull(value) as TaskId | null;

function toBook(r: Row): Book {
	return {
		id: String(r.id),
		kind: r.kind === "epub-translate" ? "epub-translate" : "pdf-ocr",
		fileName: String(r.file_name),
		title: String(r.title),
		author: String(r.author),
		publisher: String(r.publisher),
		year: String(r.year),
		pageCount: num(r.page_count),
		firstPage: num(r.first_page),
		lastPage: numOrNull(r.last_page),
		rendered: num(r.rendered),
		status: String(r.status) as BookStatus,
		taskId: taskIdOrNull(r.task_id),
		cover: json<Cover>(r.cover) ?? { kind: "page", page: 1 },
		toc: json<TocEntry[]>(r.toc),
		glossary: json<GlossaryEntry[]>(r.glossary),
		error: strOrNull(r.error),
		createdAt: num(r.created_at),
	};
}

function toPage(r: Row): PageRow {
	return {
		bookId: String(r.book_id),
		page: num(r.page),
		status: String(r.status) as PageStatus,
		source: strOrNull(r.source),
		raw: json<PageResult>(r.raw),
		proofread: json<PageResult>(r.proofread),
		suggestions: json<Suggestion[]>(r.suggestions),
		edited: strOrNull(r.edited),
		figures: json<Figure[]>(r.figures),
		engine: strOrNull(r.engine),
		flag: strOrNull(r.flag),
		pageLabel: strOrNull(r.page_label),
	};
}

function toBatch(r: Row): BatchRow {
	return {
		id: num(r.id),
		bookId: String(r.book_id),
		pages: json<number[]>(r.pages) ?? [],
		job: String(r.job) as BatchRow["job"],
		taskId: taskIdOrNull(r.task_id),
		state: String(r.state) as BatchState,
		stage: strOrNull(r.stage),
		provider: strOrNull(r.provider),
		wakeAt: numOrNull(r.wake_at),
		note: strOrNull(r.note),
		inputTokens: num(r.input_tokens),
		outputTokens: num(r.output_tokens),
		updatedAt: num(r.updated_at),
	};
}

const BOOK_COLUMNS = {
	title: "title",
	author: "author",
	publisher: "publisher",
	year: "year",
	pageCount: "page_count",
	rendered: "rendered",
	status: "status",
	taskId: "task_id",
	cover: "cover",
	toc: "toc",
	glossary: "glossary",
	error: "error",
} as const;

const BATCH_COLUMNS = {
	taskId: "task_id",
	state: "state",
	stage: "stage",
	provider: "provider",
	wakeAt: "wake_at",
	note: "note",
} as const;

const TOTALS = "COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost) AS cost";
const totals = (r: Row): CostTotals => ({
	requests: num(r.requests),
	inputTokens: num(r.input_tokens),
	outputTokens: num(r.output_tokens),
	cost: num(r.cost),
});

type SqlValue = string | number | null;
const sqlValue = (value: unknown): SqlValue =>
	value === null || typeof value === "string" || typeof value === "number" ? value : JSON.stringify(value);

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
	db.exec(SCHEMA);
	// Databases created before these columns existed.
	const addColumn = (table: string, column: string, definition: string) => {
		if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
			db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
		}
	};
	addColumn("pages", "page_label", "TEXT");
	addColumn("books", "first_page", "INTEGER NOT NULL DEFAULT 1");
	addColumn("books", "last_page", "INTEGER");
	addColumn("pages", "suggestions", "TEXT");
	// Books made before EPUB translation are all OCR books.
	addColumn("books", "glossary", "TEXT");
	addColumn("pages", "source", "TEXT");
	// The job CHECK of databases from before translation lacks the translation jobs; SQLite cannot alter a CHECK.
	const batchesSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'batches'").get()?.sql;
	if (typeof batchesSql === "string" && !batchesSql.includes("'glossary'")) {
		db.exec(`BEGIN;
			ALTER TABLE batches RENAME TO batches_old;
			${batchesSql.replace("'metadata')", "'metadata', 'translate', 'glossary')")};
			INSERT INTO batches SELECT * FROM batches_old;
			DROP TABLE batches_old;
			CREATE INDEX IF NOT EXISTS batches_book ON batches(book_id);
			COMMIT;`);
	}
	addColumn("books", "kind", "TEXT NOT NULL DEFAULT 'pdf-ocr' CHECK (kind IN ('pdf-ocr', 'epub-translate'))");

	function update(table: string, columns: Record<string, string>, where: string, id: SqlValue, patch: object) {
		const entries = Object.entries(patch).filter(([key]) => key in columns);
		if (entries.length === 0) return;
		const sets = entries.map(([key]) => `${columns[key]} = ?`);
		const values = entries.map(([, value]) => sqlValue(value));
		if (table === "batches") {
			sets.push("updated_at = ?");
			values.push(Date.now());
		}
		db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${where} = ?`).run(...values, id);
	}

	return {
		close: () => db.close(),

		createBook(book: { id: string; kind: BookKind; fileName: string; title: string; firstPage: number; lastPage: number | null }): Book {
			db.prepare(
				"INSERT INTO books (id, kind, file_name, title, status, cover, created_at, first_page, last_page) VALUES (?, ?, ?, ?, 'rendering', ?, ?, ?, ?)",
			).run(book.id, book.kind, book.fileName, book.title, JSON.stringify({ kind: "page", page: 1 }), Date.now(), book.firstPage, book.lastPage);
			const created = this.book(book.id);
			if (created === undefined) throw new Error(`book ${book.id} was not stored`);
			return created;
		},
		book(id: string): Book | undefined {
			const row = db.prepare("SELECT * FROM books WHERE id = ?").get(id);
			return row === undefined ? undefined : toBook(row);
		},
		books(): Book[] {
			return db.prepare("SELECT * FROM books ORDER BY created_at DESC").all().map(toBook);
		},
		updateBook(id: string, patch: Partial<Omit<Book, "id" | "fileName" | "createdAt">>) {
			update("books", BOOK_COLUMNS, "id", id, patch);
		},
		deleteBook(id: string) {
			db.prepare("DELETE FROM books WHERE id = ?").run(id);
		},

		initPages(bookId: string, count: number) {
			const insert = db.prepare("INSERT OR IGNORE INTO pages (book_id, page, status) VALUES (?, ?, 'pending')");
			for (let page = 1; page <= count; page++) insert.run(bookId, page);
		},
		/** A translation book's chunks as its pages, replacing any earlier split. */
		initChunks(bookId: string, chunks: string[]) {
			db.exec("BEGIN");
			try {
				db.prepare("DELETE FROM pages WHERE book_id = ?").run(bookId);
				const insert = db.prepare("INSERT INTO pages (book_id, page, status, source) VALUES (?, ?, 'pending', ?)");
				chunks.forEach((source, i) => insert.run(bookId, i + 1, source));
				db.prepare("UPDATE books SET page_count = ?, rendered = ? WHERE id = ?").run(chunks.length, chunks.length, bookId);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
		pages(bookId: string): PageRow[] {
			return db.prepare("SELECT * FROM pages WHERE book_id = ? ORDER BY page").all(bookId).map(toPage);
		},
		pageSummaries(bookId: string): PageSummary[] {
			const rows = db
				.prepare(
					`SELECT page, status, engine, flag, edited IS NOT NULL AS edited, proofread IS NOT NULL AS proofread, page_label,
					(SELECT COUNT(*) FROM json_each(COALESCE(suggestions, '[]')) WHERE json_extract(value, '$.status') = 'pending') AS pending,
					COALESCE(NULLIF(json_extract(proofread, '$.printedPageNumber'), ''), json_extract(raw, '$.printedPageNumber'), '') AS printed
					FROM pages WHERE book_id = ? ORDER BY page`,
				)
				.all(bookId);
			return rows.map((r) => ({
				page: num(r.page),
				status: String(r.status) as PageStatus,
				engine: strOrNull(r.engine),
				flag: strOrNull(r.flag),
				edited: r.edited === 1,
				proofread: r.proofread === 1,
				pending: num(r.pending),
				printed: String(r.printed),
				pageLabel: strOrNull(r.page_label),
			}));
		},
		page(bookId: string, page: number): PageRow | undefined {
			const row = db.prepare("SELECT * FROM pages WHERE book_id = ? AND page = ?").get(bookId, page);
			return row === undefined ? undefined : toPage(row);
		},
		/**
		 * Store one stage's result. OCR resets the proofread text and its suggestions, which were made from the previous
		 * OCR; proofread stores the suggestions it was made from.
		 */
		saveResult(
			bookId: string,
			result: PageResult,
			stage: "ocr" | "proofread",
			engine: string,
			done: boolean,
			suggestions: Suggestion[] | null = null,
		) {
			const column = stage === "ocr" ? "raw = ?, proofread = NULL" : "proofread = ?";
			db.prepare(
				`UPDATE pages SET ${column}, suggestions = ?, engine = ?, status = ?, flag = NULL WHERE book_id = ? AND page = ?`,
			).run(
				JSON.stringify(result),
				suggestions === null ? null : JSON.stringify(suggestions),
				engine,
				done ? "done" : "pending",
				bookId,
				result.page,
			);
		},
		/** Store a page's texts after suggestion decisions (`decideSuggestions`). */
		saveDecisions(bookId: string, page: number, proofread: PageResult, suggestions: Suggestion[], edited: string | null) {
			db.prepare("UPDATE pages SET proofread = ?, suggestions = ?, edited = ? WHERE book_id = ? AND page = ?").run(
				JSON.stringify(proofread),
				JSON.stringify(suggestions),
				edited,
				bookId,
				page,
			);
			return null;
		},
		markPage(bookId: string, page: number, status: PageStatus, flag: string | null) {
			db.prepare("UPDATE pages SET status = ?, flag = ? WHERE book_id = ? AND page = ?").run(status, flag, bookId, page);
		},
		saveEdit(bookId: string, page: number, markdown: string | null) {
			db.prepare("UPDATE pages SET edited = ? WHERE book_id = ? AND page = ?").run(markdown, bookId, page);
		},
		savePageLabel(bookId: string, page: number, label: string | null) {
			db.prepare("UPDATE pages SET page_label = ? WHERE book_id = ? AND page = ?").run(label, bookId, page);
		},
		saveFigures(bookId: string, page: number, figures: Figure[] | null) {
			db.prepare("UPDATE pages SET figures = ? WHERE book_id = ? AND page = ?").run(
				figures === null ? null : JSON.stringify(figures),
				bookId,
				page,
			);
		},
		/** Before a re-run: drop the user's edits and boxes so the new model output shows. */
		resetPages(bookId: string, pages: number[]) {
			const reset = db.prepare(
				"UPDATE pages SET status = 'pending', edited = NULL, figures = NULL, flag = NULL WHERE book_id = ? AND page = ?",
			);
			for (const page of pages) reset.run(bookId, page);
		},

		createBatch(bookId: string, pages: number[], job: BatchRow["job"], owner: number | null): number {
			const result = db
				.prepare("INSERT INTO batches (book_id, pages, job, owner, state, updated_at) VALUES (?, ?, ?, ?, 'queued', ?)")
				.run(bookId, JSON.stringify(pages), job, owner, Date.now());
			return num(result.lastInsertRowid);
		},
		/** Batches a crashed planning pass of `owner` recorded before its tasks were committed. */
		deleteBatchesOf(owner: number) {
			db.prepare("DELETE FROM batches WHERE owner = ?").run(owner);
		},
		/**
		 * A translation book plans one batch at a time, each after the last settled, so a queued batch of `owner` is one a
		 * crashed planning pass recorded before its task was committed.
		 */
		deleteQueuedBatchesOf(owner: number) {
			db.prepare("DELETE FROM batches WHERE owner = ? AND state = 'queued'").run(owner);
		},
		batchByTask(taskId: number): BatchRow | undefined {
			const row = db.prepare("SELECT * FROM batches WHERE task_id = ?").get(taskId);
			return row === undefined ? undefined : toBatch(row);
		},
		batch(id: number): BatchRow | undefined {
			const row = db.prepare("SELECT * FROM batches WHERE id = ?").get(id);
			return row === undefined ? undefined : toBatch(row);
		},
		batches(bookId: string): BatchRow[] {
			return db.prepare("SELECT * FROM batches WHERE book_id = ? ORDER BY id").all(bookId).map(toBatch);
		},
		updateBatch(id: number, patch: Partial<Pick<BatchRow, keyof typeof BATCH_COLUMNS>>) {
			update("batches", BATCH_COLUMNS, "id", id, patch);
		},
		addTokens(batchId: number, input: number, output: number) {
			db.prepare(
				"UPDATE batches SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?",
			).run(input, output, batchId);
		},
		/** Batches left unfinished by an aborted job. */
		abortOpenBatches(bookId: string) {
			db.prepare(
				"UPDATE batches SET state = 'aborted', wake_at = NULL, updated_at = ? WHERE book_id = ? AND state NOT IN ('done', 'failed', 'aborted')",
			).run(Date.now(), bookId);
		},

		logUsage(u: { request: string; bookId: string; provider: string; model: string; stage: string; inputTokens: number; outputTokens: number; cost: number; at: number }) {
			const title = this.book(u.bookId)?.title ?? "";
			db.prepare(
				"INSERT OR IGNORE INTO usage (request, book_id, book_title, provider, model, stage, input_tokens, output_tokens, cost, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			).run(u.request, u.bookId, title, u.provider, u.model, u.stage, u.inputTokens, u.outputTokens, u.cost, u.at);
		},
		/** A book's costs per provider, model and stage. */
		bookCosts(bookId: string): CostByStage[] {
			return db
				.prepare(`SELECT provider, model, stage, ${TOTALS} FROM usage WHERE book_id = ? GROUP BY provider, model, stage ORDER BY cost DESC`)
				.all(bookId)
				.map((r) => ({ provider: String(r.provider), model: String(r.model), stage: String(r.stage), ...totals(r) }));
		},
		/** Costs of every book, deleted ones included, per book and per provider and model. */
		costs(): { byBook: CostByBook[]; byModel: CostByModel[] } {
			const byBook = db
				.prepare(
					// The current title; for a deleted book, the title at its last request.
					`SELECT u.book_id, COALESCE(b.title, (SELECT book_title FROM usage l WHERE l.book_id = u.book_id ORDER BY at DESC LIMIT 1)) AS book_title,
					b.id IS NULL AS deleted, ${TOTALS} FROM usage u LEFT JOIN books b ON b.id = u.book_id GROUP BY u.book_id ORDER BY MAX(u.at) DESC`,
				)
				.all()
				.map((r) => ({ bookId: String(r.book_id), title: String(r.book_title), deleted: r.deleted === 1, ...totals(r) }));
			const byModel = db
				.prepare(`SELECT provider, model, ${TOTALS} FROM usage GROUP BY provider, model ORDER BY cost DESC`)
				.all()
				.map((r) => ({ provider: String(r.provider), model: String(r.model), ...totals(r) }));
			return { byBook, byModel };
		},

		logRequest(provider: string, at: number) {
			db.prepare("INSERT INTO requests (provider, at) VALUES (?, ?)").run(provider, at);
		},
		/** Request times of `provider` since `since`, oldest first. */
		requestsSince(provider: string, since: number): number[] {
			return db
				.prepare("SELECT at FROM requests WHERE provider = ? AND at >= ? ORDER BY at")
				.all(provider, since)
				.map((r) => num(r.at));
		},
		pruneRequests(before: number) {
			db.prepare("DELETE FROM requests WHERE at < ?").run(before);
		},
		setExhausted(provider: string, until: number, reason: string) {
			db.prepare("INSERT OR REPLACE INTO exhausted (provider, until, reason) VALUES (?, ?, ?)").run(provider, until, reason);
		},
		exhaustedUntil(provider: string, now: number): number | null {
			const row = db.prepare("SELECT until FROM exhausted WHERE provider = ? AND until > ?").get(provider, now);
			return row === undefined ? null : num(row.until);
		},
	};
}
