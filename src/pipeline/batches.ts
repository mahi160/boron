import type { TaskId, Tx } from "@earendil-works/pi-durable";
import type { Store } from "../store.ts";
import type { BatchTask } from "./batch-task.ts";
import type { Deps } from "./deps.ts";
import { JOBS, type Job } from "./jobs.ts";

export type BatchPlan = {
	bookId: string;
	pages: number[];
	job: Job;
	/** The book task the batches belong to; null for a re-run, owned by the root conversation. */
	owner: TaskId | null;
};

/** Split `pages` into the job's batches, record each, and create its task in `tx`. */
export async function planBatches(tx: Tx, deps: Pick<Deps, "store" | "settings">, Batch: BatchTask, plan: BatchPlan): Promise<TaskId[]> {
	const { bookId, pages, job, owner } = plan;
	const size = JOBS[job].batchSize(deps.settings());
	const parts: number[][] = [];
	// A job of the whole book (the glossary) runs once, even without pages.
	if (size === null) parts.push(pages);
	else for (let i = 0; i < pages.length; i += size) parts.push(pages.slice(i, i + size));
	const ownership = owner === null ? { kind: "conversation" as const } : { kind: "task" as const, taskId: owner };
	const ids: TaskId[] = [];
	for (const part of parts) {
		const batchId = deps.store.createBatch(bookId, part, job, owner);
		const id = await tx.createTask(Batch, { bookId, batchId, pages: part, job }, { ownership });
		deps.store.updateBatch(batchId, { taskId: id });
		ids.push(id);
	}
	return ids;
}

/** Mark a batch's pages failed, if they are its to fail. */
export function failPages(store: Store, batch: { bookId: string; pages: number[]; job: Job }, reason: string) {
	if (!JOBS[batch.job].ownsPages) return;
	for (const page of batch.pages) store.markPage(batch.bookId, page, "failed", reason);
}
