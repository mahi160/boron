import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TaskId } from "@earendil-works/pi-durable";
import type { Figure, PageResult } from "./pipeline/contract.ts";

/** App data: books, pages, batches, limiter log. pi-durable keeps its own database for tasks. */

export type BookStatus = "rendering" | "running" | "paused" | "aborted" | "ready" | "failed";
export type Cover = { kind: "page"; page: number } | { kind: "upload" };
/** One chapter entry. `id` is `<page>:<heading index>` for a tagged heading or `<page>:split` for an inserted one. */
export type TocEntry = { id: string; page: number; title: string; level: number };

export type Book = {
	id: string;
	fileName: string;
	title: string;
	author: string;
	publisher: string;
	year: string;
	pageCount: number;
	/** Pages rendered to images so far. */
	rendered: number;
	status: BookStatus;
	/** The book's current or last job (a pi-durable `boron.book` task). */
	taskId: TaskId | null;
	cover: Cover;
	toc: TocEntry[] | null;
	error: string | null;
	createdAt: number;
};

export type PageStatus = "pending" | "done" | "flagged" | "failed";

export type PageRow = {
	bookId: string;
	page: number;
	status: PageStatus;
	raw: PageResult | null;
	proofread: PageResult | null;
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
	job: "pages" | "metadata";
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
	/** Printed page number the model read, "" if none. */
	printed: string;
	pageLabel: string | null;
};

/** A task pi-durable set aside after it crashed the process repeatedly. */
export type Parked = { taskId: TaskId; batchId: number | null; bookId: string | null; reason: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
	id TEXT PRIMARY KEY, file_name TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '',
	publisher TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '', page_count INTEGER NOT NULL DEFAULT 0,
	rendered INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL CHECK (status IN ('rendering', 'running', 'paused', 'aborted', 'ready', 'failed')),
	task_id INTEGER, cover TEXT NOT NULL, toc TEXT, error TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
	book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, page INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'flagged', 'failed')), raw TEXT, proofread TEXT, edited TEXT, figures TEXT, engine TEXT, flag TEXT, page_label TEXT, PRIMARY KEY (book_id, page)
);
CREATE TABLE IF NOT EXISTS batches (
	id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
	pages TEXT NOT NULL, job TEXT NOT NULL CHECK (job IN ('pages', 'metadata')),
	-- The book task that planned this batch; null for a re-run started from the review screen.
	owner INTEGER, task_id INTEGER,
	state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting', 'retrying', 'done', 'failed', 'aborted')), stage TEXT, provider TEXT, wake_at INTEGER, note TEXT,
	input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS batches_book ON batches(book_id);
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
		fileName: String(r.file_name),
		title: String(r.title),
		author: String(r.author),
		publisher: String(r.publisher),
		year: String(r.year),
		pageCount: num(r.page_count),
		rendered: num(r.rendered),
		status: String(r.status) as BookStatus,
		taskId: taskIdOrNull(r.task_id),
		cover: json<Cover>(r.cover) ?? { kind: "page", page: 1 },
		toc: json<TocEntry[]>(r.toc),
		error: strOrNull(r.error),
		createdAt: num(r.created_at),
	};
}

function toPage(r: Row): PageRow {
	return {
		bookId: String(r.book_id),
		page: num(r.page),
		status: String(r.status) as PageStatus,
		raw: json<PageResult>(r.raw),
		proofread: json<PageResult>(r.proofread),
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
		job: r.job === "metadata" ? "metadata" : "pages",
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

type SqlValue = string | number | null;
const sqlValue = (value: unknown): SqlValue =>
	value === null || typeof value === "string" || typeof value === "number" ? value : JSON.stringify(value);

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
	db.exec(SCHEMA);
	// Databases created before page labels existed.
	if (!db.prepare("PRAGMA table_info(pages)").all().some((c) => c.name === "page_label")) {
		db.exec("ALTER TABLE pages ADD COLUMN page_label TEXT");
	}

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

		createBook(book: { id: string; fileName: string; title: string }): Book {
			db.prepare(
				"INSERT INTO books (id, file_name, title, status, cover, created_at) VALUES (?, ?, ?, 'rendering', ?, ?)",
			).run(book.id, book.fileName, book.title, JSON.stringify({ kind: "page", page: 1 }), Date.now());
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
		pages(bookId: string): PageRow[] {
			return db.prepare("SELECT * FROM pages WHERE book_id = ? ORDER BY page").all(bookId).map(toPage);
		},
		pageSummaries(bookId: string): PageSummary[] {
			const rows = db
				.prepare(
					`SELECT page, status, engine, flag, edited IS NOT NULL AS edited, proofread IS NOT NULL AS proofread, page_label,
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
				printed: String(r.printed),
				pageLabel: strOrNull(r.page_label),
			}));
		},
		page(bookId: string, page: number): PageRow | undefined {
			const row = db.prepare("SELECT * FROM pages WHERE book_id = ? AND page = ?").get(bookId, page);
			return row === undefined ? undefined : toPage(row);
		},
		/** Store one stage's result. OCR resets the proofread text, which was made from the previous OCR. */
		saveResult(bookId: string, result: PageResult, stage: "ocr" | "proofread", engine: string, done: boolean) {
			const column = stage === "ocr" ? "raw = ?, proofread = NULL" : "proofread = ?";
			db.prepare(
				`UPDATE pages SET ${column}, engine = ?, status = ?, flag = NULL WHERE book_id = ? AND page = ?`,
			).run(JSON.stringify(result), engine, done ? "done" : "pending", bookId, result.page);
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
