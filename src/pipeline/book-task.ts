import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTask, type TaskId } from "@earendil-works/pi-durable";
import { openPdf } from "../render.ts";
import type { BatchTask } from "./batch-task.ts";
import type { Deps } from "./deps.ts";

export type BookInput = { bookId: string };
type BookState = { phase: "render" } | { phase: "plan" } | { phase: "finish" };

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
				const { imageMaxSide, jpegQuality } = deps.settings();
				const pdf = await openPdf(deps.sourcePdf(bookId));
				try {
					// The upload checked the range against the PDF; book page n is PDF page firstPage + n - 1.
					const last = Math.min(book.lastPage ?? pdf.pageCount, pdf.pageCount);
					const pageCount = last - book.firstPage + 1;
					store.updateBook(bookId, { pageCount });
					store.initPages(bookId, pageCount);
					for (let page = 1; page <= pageCount; page++) {
						if (runtime.signal.aborted) return;
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
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "plan" } }), context);
			},

			plan: async (task, runtime, context) => {
				const { bookId } = task.input;
				const book = store.book(bookId);
				if (book === undefined) return runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
				const settings = deps.settings();
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
						const batchId = store.createBatch(bookId, pages, job, task.id);
						const id = await tx.createTask(Batch, { bookId, batchId, pages, job }, { ownership: { kind: "task", taskId: task.id } });
						store.updateBatch(batchId, { taskId: id });
						ids.push(id);
					};
					for (const pages of chunk(todo, settings.pagesPerRequest)) await plan(pages, "pages");
					if (needsMetadata) await plan(titlePages, "metadata");
					if (ids.length === 0) return { status: "running", checkpoint: { phase: "finish" } };
					return { status: "waiting", checkpoint: { phase: "finish" }, on: ids, policy: "allSettled" };
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
