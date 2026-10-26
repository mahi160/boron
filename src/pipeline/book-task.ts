import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTask, type TaskId, type Tx } from "@earendil-works/pi-durable";
import { chunkMarkdown, readEpub } from "../epub/source.ts";
import { openPdf } from "../render.ts";
import type { Job } from "./jobs.ts";
import type { BatchTask } from "./batch-task.ts";
import type { Book, BookKind } from "../store.ts";
import type { Deps } from "./deps.ts";

export type BookInput = { bookId: string };
// `render` is the per-kind prepare step; the name stays so jobs checkpointed before EPUB books existed resume.
type BookState =
	| { phase: "render" }
	| { phase: "plan" }
	/** Translation books: translate the first unfinished chunk after `after`, one at a time. */
	| { phase: "translate"; after: number }
	| { phase: "finish" };

/** How many leading pages the metadata pass looks at for the title page. */
const TITLE_PAGES = 4;

async function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * One book job: render every page to an image, read the unfinished pages in batches (child tasks, all at once; the
 * limiter paces them), pre-fill metadata from the title pages, then mark the book ready. Pausing aborts this task;
 * resuming starts a new one, which skips rendered images and finished pages.
 */
export function createBookTask(deps: Deps, Batch: BatchTask) {
	const { store } = deps;

	/** Record a batch of the book task `owner` and create its task in `tx`. */
	async function planBatch(tx: Tx, owner: TaskId, bookId: string, pages: number[], job: Job): Promise<TaskId> {
		const batchId = store.createBatch(bookId, pages, job, owner);
		const id = await tx.createTask(Batch, { bookId, batchId, pages, job }, { ownership: { kind: "task", taskId: owner } });
		store.updateBatch(batchId, { taskId: id });
		return id;
	}

	/** Render the book's PDF pages to images and create its page rows. False if aborted midway. */
	async function renderPdf(book: Book, signal: AbortSignal): Promise<boolean> {
		const bookId = book.id;
		const { imageMaxSide, jpegQuality } = deps.settings();
		const pdf = await openPdf(deps.sourcePdf(bookId));
		try {
			// The upload checked the range against the PDF; book page n is PDF page firstPage + n - 1.
			const last = Math.min(book.lastPage ?? pdf.pageCount, pdf.pageCount);
			const pageCount = last - book.firstPage + 1;
			store.updateBook(bookId, { pageCount });
			store.initPages(bookId, pageCount);
			for (let page = 1; page <= pageCount; page++) {
				if (signal.aborted) return false;
				const path = deps.pageImage(bookId, page);
				if (!(await exists(path))) {
					await mkdir(dirname(path), { recursive: true });
					await writeFile(`${path}.tmp`, await pdf.render(book.firstPage + page - 1, { maxSide: imageMaxSide, quality: jpegQuality }));
					await rename(`${path}.tmp`, path);
				}
				store.updateBook(bookId, { rendered: page });
				deps.changed(bookId);
			}
		} finally {
			await pdf.close();
		}
		return true;
	}

	/** Split the book's EPUB into chunks (once: a resumed job keeps the split) and carry its images over. */
	async function chunkEpub(book: Book): Promise<boolean> {
		if (book.pageCount > 0) return true;
		const source = readEpub(await readFile(deps.sourceEpub(book.id)));
		for (const image of source.images) {
			const path = deps.bookImage(book.id, image.file);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, image.data);
		}
		store.initChunks(book.id, chunkMarkdown(source.markdown, deps.settings().chunkWords));
		deps.changed(book.id);
		return true;
	}

	/** Make the book's pages ready to read, the way its kind needs. */
	const prepare: Record<BookKind, (book: Book, signal: AbortSignal) => Promise<boolean>> = {
		"pdf-ocr": renderPdf,
		"epub-translate": chunkEpub,
	};

	return defineTask<BookInput, BookState, null>({
		name: "boron.book",
		version: 1,
		initial: () => ({ phase: "render" }),
		phases: {
			render: async (task, runtime, context) => {
				const { bookId } = task.input;
				const book = store.book(bookId);
				if (book === undefined) {
					return runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
				}
				store.updateBook(bookId, { status: "rendering" });
				deps.changed(bookId);
				if (!(await prepare[book.kind](book, runtime.signal))) return;
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "plan" } }), context);
			},

			plan: async (task, runtime, context) => {
				const { bookId } = task.input;
				const book = store.book(bookId);
				if (book === undefined) return runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
				const settings = deps.settings();
				if (book.kind === "epub-translate") {
					// The glossary comes first, so every chunk is translated with it.
					store.deleteQueuedBatchesOf(task.id);
					store.updateBook(bookId, { status: "running", error: null });
					const glossary = book.glossary === null && settings.stages.proofread.length > 0;
					await runtime.commit(async (tx) => {
						if (!glossary) return { status: "running", checkpoint: { phase: "translate", after: 0 } };
						const id = await planBatch(tx, task.id, bookId, [], "glossary");
						return { status: "waiting", checkpoint: { phase: "translate", after: 0 }, on: [id], policy: "allSettled" };
					}, context);
					deps.changed(bookId);
					return;
				}
				const todo = store
					.pages(bookId)
					.filter((p) => p.status === "pending" || p.status === "failed")
					.map((p) => p.page);
				const titlePages = Array.from({ length: Math.min(TITLE_PAGES, book.pageCount) }, (_, i) => i + 1);
				const needsMetadata = book.author === "" && settings.stages.assemble.length > 0 && titlePages.length > 0;
				store.deleteBatchesOf(task.id);
				store.updateBook(bookId, { status: "running", error: null });
				await runtime.commit(async (tx) => {
					const ids: TaskId[] = [];
					const plan = async (pages: number[], job: "pages" | "metadata") => {
						ids.push(await planBatch(tx, task.id, bookId, pages, job));
					};
					for (const pages of chunk(todo, settings.pagesPerRequest)) await plan(pages, "pages");
					if (needsMetadata) await plan(titlePages, "metadata");
					if (ids.length === 0) return { status: "running", checkpoint: { phase: "finish" } };
					return { status: "waiting", checkpoint: { phase: "finish" }, on: ids, policy: "allSettled" };
				}, context);
				deps.changed(bookId);
			},

			translate: async (task, runtime, context) => {
				const { bookId } = task.input;
				const { after } = task.state.checkpoint;
				if (store.book(bookId) === undefined) return runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
				store.deleteQueuedBatchesOf(task.id);
				// Finished chunks are skipped; each waits for the one before, whose Bangla it is given as context.
				const next = store.pages(bookId).find((p) => p.page > after && (p.status === "pending" || p.status === "failed"))?.page;
				await runtime.commit(async (tx) => {
					if (next === undefined) return { status: "running", checkpoint: { phase: "finish" } };
					const id = await planBatch(tx, task.id, bookId, [next], "translate");
					return { status: "waiting", checkpoint: { phase: "translate", after: next }, on: [id], policy: "allSettled" };
				}, context);
				deps.changed(bookId);
			},

			finish: async (task, runtime, context) => {
				const { bookId } = task.input;
				if (store.book(bookId) !== undefined) {
					store.updateBook(bookId, { status: "ready" });
					deps.changed(bookId);
				}
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
			},
		},
		abort: async (task, runtime, context) => {
			store.abortOpenBatches(task.input.bookId);
			deps.changed(task.input.bookId);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
		},
	});
}

export type BookTask = ReturnType<typeof createBookTask>;
