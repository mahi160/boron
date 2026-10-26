import { spawn } from "node:child_process";
import { join } from "node:path";
import { fauxAssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { UserEntry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, it } from "vitest";
import { context, openHarness } from "../src/harness.ts";
import { OcrPage } from "../src/ocr-task.ts";
import { fauxModels, samplePdf, tempDir } from "./helpers/ocr.ts";

/** Run the fixture until its model request is in flight, then SIGKILL it. */
async function crashMidRequest(dbPath: string, pdfPath: string): Promise<void> {
	const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures/crash-run.ts"), dbPath, pdfPath], {
		stdio: ["ignore", "pipe", "inherit"],
	});
	const exited = new Promise((resolve) => child.on("exit", resolve));
	try {
		await new Promise<void>((resolve, reject) => {
			void exited.then((code) => reject(new Error(`fixture exited early with ${code}`)));
			child.stdout.on("data", (chunk: Buffer) => {
				if (chunk.toString().includes("REQUEST")) resolve();
			});
		});
	} finally {
		child.kill("SIGKILL");
		await exited;
	}
}

it("resumes an OCR task killed mid-request without submitting its input twice", { timeout: 30_000 }, async () => {
	const dir = await tempDir();
	const dbPath = join(dir, "boron.sqlite");
	const pdfPath = await samplePdf(dir);
	await crashMidRequest(dbPath, pdfPath);

	const requests: TranscriptContext[] = [];
	const { models } = fauxModels((request) => {
		requests.push(request);
		return fauxAssistantMessage("পুনরায়");
	});
	const harness = await openHarness(await openNodeSqliteStorage(dbPath), models);
	try {
		const root = await harness.root(context);
		const tasks = await root.commit((tx) => tx.scanTasks({ kind: OcrPage.definition.name }, 10), context);
		expect(tasks.items).toHaveLength(1);
		const [task] = tasks.items;
		if (task === undefined) throw new Error("no task");
		harness.resume();

		const settled = await harness.waitForTask(task.id, context);

		expect(settled.state.outcome).toMatchObject({ status: "completed", result: { page: 1, text: "পুনরায়" } });
		// The model request is sent again after the crash, carrying the one user message admitted before it.
		expect(requests).toHaveLength(1);
		expect(requests[0]?.messages.filter((m) => m.role === "user")).toHaveLength(1);
		const { entries, submission } = await root.commit(async (tx) => {
			const children = await tx.scanConversations({ ownerTaskId: task.id }, 10);
			expect(children.items).toHaveLength(1);
			const [child] = children.items;
			if (child === undefined) throw new Error("no OCR conversation");
			return {
				entries: await tx.scanEntries({ conversationId: child.id }, 100),
				submission: await tx.submissionByRequest(child.id, `ocr:${task.id}`),
			};
		}, context);
		expect(entries.items.filter((entry) => UserEntry.is(entry))).toHaveLength(1);
		expect(submission).toMatchObject({ status: "done", requestId: `ocr:${task.id}` });
	} finally {
		await harness.close(context);
	}
});
