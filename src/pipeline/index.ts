import { defineExtension } from "@earendil-works/pi-durable";
import { createBatchTask } from "./batch-task.ts";
import { createBookTask } from "./book-task.ts";
import type { Deps } from "./deps.ts";

export function createPipeline(deps: Deps) {
	const Batch = createBatchTask(deps);
	const Book = createBookTask(deps, Batch);
	return { Batch, Book, extension: defineExtension({ name: "boron", tasks: [Book, Batch] }) };
}

export type Pipeline = ReturnType<typeof createPipeline>;
