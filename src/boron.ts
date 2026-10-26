import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type Storage, type TaskId } from "@earendil-works/pi-durable";
import type { SourceEpub } from "./epub/source.ts";
import { toCoverJpeg } from "./figures.ts";
import type { Deps } from "./pipeline/deps.ts";
import { createLimiter } from "./pipeline/limiter.ts";
import { createPipeline } from "./pipeline/index.ts";
import type { Settings } from "./settings.ts";
import type { Parked, Store } from "./store.ts";

export const context = BACKGROUND_CONTEXT;

export type BoronOptions = {
	storage: Storage;
	store: Store;
	settings: () => Settings;
	models: (settings: Settings) => Models;
	tesseract: Deps["tesseract"];
	/** Directory of book files: `<booksDir>/<id>/source.pdf`, `pages/0001.jpg`, `cover.jpg`. */
	booksDir: string;
	now?: () => number;
};


/** The application without HTTP: books, jobs, re-runs. */
export async function createBoron(options: BoronOptions) {
	const { store, settings } = options;
	const now = options.now ?? Date.now;
	const listeners = new Set<(bookId: string) => void>();
	const changed = (bookId: string) => {
		for (const listener of listeners) listener(bookId);
	};
	const files = {
		dir: (bookId: string) => join(options.booksDir, bookId),
		source: (bookId: string) => join(options.booksDir, bookId, "source.pdf"),
		sourceEpub: (bookId: string) => join(options.booksDir, bookId, "source.epub"),
		image: (bookId: string, file: string) => join(options.booksDir, bookId, "images", file),
		page: (bookId: string, page: number) => join(options.booksDir, bookId, "pages", `${String(page).padStart(4, "0")}.jpg`),
		cover: (bookId: string) => join(options.booksDir, bookId, "cover.jpg"),
	};
	const limiter = createLimiter(store, now);
	const pipeline = createPipeline({
		store,
		settings,
		limiter,
		now,
		changed,
		sourcePdf: files.source,
		sourceEpub: files.sourceEpub,
		bookImage: files.image,
		pageImage: files.page,
		tesseract: options.tesseract,
	});
	const registry = createRegistry();
	registry.install(pipeline.extension);
	const harness = await Harness.open(
		options.storage,
		{
			models: () => options.models(settings()),
			registry,
			now,
			// Retries of transient errors are pi-durable's; 429s are not retried there (see PLAN.md) but by the batch.
			settings: { retry: { maxRetries: 3 } },
			onReport: (error, info) => {
				if (info.type !== "task_faulted" && info.type !== "task_parked") return;
				const message = error instanceof Error ? error.message : String(error);
				const batch = store.batchByTask(Number(info.task.id));
				if (batch !== undefined && info.type === "task_faulted") {
					store.updateBatch(batch.id, { state: "failed", note: message.slice(0, 300) });
					// The metadata batch only looks at the title pages; their text is not its to fail.
					if (batch.job === "pages" || batch.job === "translate") for (const page of batch.pages) store.markPage(batch.bookId, page, "failed", message.slice(0, 300));
					changed(batch.bookId);
				}
				const book = store.books().find((b) => b.taskId === Number(info.task.id));
				if (book !== undefined && info.type === "task_faulted") {
					store.updateBook(book.id, { status: "failed", error: message.slice(0, 500) });
					changed(book.id);
				}
				if (info.type === "task_parked") changed(batch?.bookId ?? book?.id ?? "");
			},
		},
		context,
	);
	const root = await harness.root(context);
	harness.resume();

	/** Abort a task and wait until it and the work it owns have ended. */
	async function abortIfLive(taskId: TaskId | null) {
		if (taskId === null || !(await isLive(taskId))) return;
		await harness.abortTask(taskId, context);
		await harness.waitForTask(taskId, context);
	}

	async function isLive(taskId: TaskId | null): Promise<boolean> {
		if (taskId === null) return false;
		const task = await harness.getTask(taskId, context);
		return task !== undefined && task.state.status !== "terminal";
	}

	async function start(bookId: string) {
		const taskId = await root.commit(
			(tx) => tx.createTask(pipeline.Book, { bookId }, { ownership: { kind: "conversation" } }),
			context,
		);
		store.updateBook(bookId, { taskId, status: "rendering", error: null });
		changed(bookId);
	}

	/** The book's job and any page re-runs that have not ended. */
	async function liveTasks(bookId: string): Promise<TaskId[]> {
		const ids = [store.book(bookId)?.taskId ?? null, ...store.batches(bookId).map((b) => b.taskId)];
		const live: TaskId[] = [];
		for (const id of ids) if (id !== null && !live.includes(id) && (await isLive(id))) live.push(id);
		return live;
	}

	/** Stop all reading of the book: in-flight requests are cancelled, finished pages stay. */
	async function stop(bookId: string, status: "paused" | "aborted") {
		const live = await liveTasks(bookId);
		if (live.length === 0) return;
		for (const id of live) await abortIfLive(id);
		// Written after the tasks have ended, so no phase still running can overwrite it.
		store.updateBook(bookId, { status });
		changed(bookId);
	}

	// Books whose reading is being started: two quick clicks must not start two readers of the same pages.
	const starting = new Set<string>();

	/** Start reading with `begin` unless the book is already being read (then false). */
	async function exclusive(bookId: string, begin: () => Promise<void>): Promise<boolean> {
		if (store.book(bookId) === undefined || starting.has(bookId)) return false;
		starting.add(bookId);
		try {
			if ((await liveTasks(bookId)).length > 0) return false;
			await begin();
			return true;
		} finally {
			starting.delete(bookId);
		}
	}

	return {
		harness,
		files,
		subscribe(listener: (bookId: string) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		/** Add a book of the PDF's pages `firstPage` to `lastPage` (null = to the end), already checked against the PDF. */
		async addBook(fileName: string, pdf: Uint8Array, range: { firstPage: number; lastPage: number | null } = { firstPage: 1, lastPage: null }) {
			const id = randomUUID();
			await mkdir(files.dir(id), { recursive: true });
			await writeFile(files.source(id), pdf);
			store.createBook({ id, kind: "pdf-ocr", fileName, title: fileName.replace(/\.pdf$/i, ""), ...range });
			await start(id);
			return id;
		},
		/** Add an English EPUB to translate, already read by `readEpub`: its title, author and cover are taken over. */
		async addEpub(fileName: string, data: Uint8Array, source: SourceEpub) {
			const id = randomUUID();
			await mkdir(files.dir(id), { recursive: true });
			await writeFile(files.sourceEpub(id), data);
			const cover = source.cover === null ? null : await toCoverJpeg(source.cover.data).catch(() => null);
			if (cover !== null) await writeFile(files.cover(id), cover);
			const title = source.title || fileName.replace(/\.epub$/i, "");
			store.createBook({ id, kind: "epub-translate", fileName, title, firstPage: 1, lastPage: null });
			store.updateBook(id, { author: source.author, cover: cover === null ? { kind: "none" } : { kind: "upload" } });
			await start(id);
			return id;
		},
		pause: (bookId: string) => stop(bookId, "paused"),
		abort: (bookId: string) => stop(bookId, "aborted"),
		/** Continue a paused, aborted or failed job; finished pages are skipped. False while the book is being read. */
		resume: (bookId: string) => exclusive(bookId, () => start(bookId)),
		async remove(bookId: string) {
			if (store.book(bookId) === undefined) return;
			for (const id of await liveTasks(bookId)) await abortIfLive(id);
			store.deleteBook(bookId);
			await rm(files.dir(bookId), { recursive: true, force: true });
			changed(bookId);
		},

		/**
		 * Read pages again from scratch (after the user confirmed): their edits and boxes are dropped.
		 * False while the book is being read, which would read the same pages twice.
		 */
		rerun: (bookId: string, pages: number[]) =>
			exclusive(bookId, async () => {
				store.resetPages(bookId, pages);
				// As many pages per request as a book job sends; a translation book sends one chunk.
				const translate = store.book(bookId)?.kind === "epub-translate";
				const job = translate ? ("translate" as const) : ("pages" as const);
				const size = translate ? 1 : settings().pagesPerRequest;
				for (let i = 0; i < pages.length; i += size) {
					const chunk = pages.slice(i, i + size);
					const batchId = store.createBatch(bookId, chunk, job, null);
					const taskId = await root.commit(
						(tx) => tx.createTask(pipeline.Batch, { bookId, batchId, pages: chunk, job }, { ownership: { kind: "conversation" } }),
						context,
					);
					store.updateBatch(batchId, { taskId });
				}
				changed(bookId);
			}),

		/** Tasks parked after crashing the process repeatedly. */
		async parked(): Promise<Parked[]> {
			const inspection = await harness.inspect(context);
			return inspection.tasks.flatMap((t) => {
				if (t.state.kind !== "blocked") return [];
				const taskId = t.record.id;
				const batch = store.batchByTask(taskId);
				const book = batch === undefined ? store.books().find((b) => b.taskId === taskId) : undefined;
				return [{ taskId, batchId: batch?.id ?? null, bookId: batch?.bookId ?? book?.id ?? null, reason: t.state.reason }];
			});
		},
		/** Run a parked task again; `taskId` comes from the browser, so only a currently parked task is accepted. */
		async retryParked(taskId: number): Promise<boolean> {
			const inspection = await harness.inspect(context);
			const parked = inspection.tasks.find((t) => t.state.kind === "blocked" && t.record.id === taskId);
			if (parked === undefined) return false;
			await harness.retryTask(parked.record.id, context);
			return true;
		},

		close: () => harness.close(context),
	};
}

export type Boron = Awaited<ReturnType<typeof createBoron>>;
