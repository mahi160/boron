// Spike (#01): OCR one PDF page through a durable pi-durable task on SQLite.
// Usage: pnpm spike [pdf] [page]   (defaults: the Gora sample, page 20; GEMINI_API_KEY from .env)
// Kill it mid-request and rerun: the same task resumes and reuses its submission.
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { UserEntry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { context, openHarness } from "../src/harness.ts";
import { OcrPage, type OcrPageInput } from "../src/ocr-task.ts";

const GORA_URL =
	"https://upload.wikimedia.org/wikipedia/commons/7/7d/%E0%A6%97%E0%A7%8B%E0%A6%B0%E0%A6%BE-%E0%A6%B0%E0%A6%AC%E0%A7%80%E0%A6%A8%E0%A7%8D%E0%A6%A6%E0%A7%8D%E0%A6%B0%E0%A6%A8%E0%A6%BE%E0%A6%A5_%E0%A6%A0%E0%A6%BE%E0%A6%95%E0%A7%81%E0%A6%B0.pdf";
const GORA_PATH = resolve("samples/gora.pdf");

async function ensureGora(): Promise<void> {
	try {
		await access(GORA_PATH);
		return;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	console.error(`downloading the Gora sample (38 MB) to ${GORA_PATH}`);
	const response = await fetch(GORA_URL, { headers: { "user-agent": "boron-spike/0.1" } });
	if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
	await mkdir("samples", { recursive: true });
	// Write then rename, so an interrupted download never passes the access() check above.
	await writeFile(`${GORA_PATH}.part`, new Uint8Array(await response.arrayBuffer()));
	await rename(`${GORA_PATH}.part`, GORA_PATH);
}

function positiveInt(name: string, value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer, got "${value}"`);
	return parsed;
}

const pdfPath = process.argv[2] === undefined ? GORA_PATH : resolve(process.argv[2]);
const page = positiveInt("page", process.argv[3] ?? "20");
if (pdfPath === GORA_PATH) await ensureGora();

const models = createModels();
models.setProvider(googleProvider());
const input: OcrPageInput = {
	pdfPath,
	page,
	model: { provider: "google", modelId: process.env.BORON_OCR_MODEL ?? "gemini-3.5-flash" },
	maxSide: positiveInt("BORON_MAX_SIDE", process.env.BORON_MAX_SIDE ?? "2000"),
};

await mkdir("data", { recursive: true });
const harness = await openHarness(await openNodeSqliteStorage(resolve("data/spike.sqlite")), models);
try {
	const root = await harness.root(context);
	const id = await root.commit(async (tx) => {
		// A failed task is not reused, so a rerun retries after a 503 or 429.
		const existing = (await tx.scanTasks({ kind: OcrPage.definition.name, order: "descending" }, 100)).items.find(
			(task) =>
				JSON.stringify(task.input) === JSON.stringify(input) &&
				!(task.state.status === "terminal" && task.state.outcome.status !== "completed"),
		);
		if (existing !== undefined) {
			console.error(`reusing task ${existing.id} (${existing.state.status})`);
			return existing.id;
		}
		const created = await tx.createTask(OcrPage, input, { ownership: { kind: "conversation" } });
		console.error(`created task ${created}`);
		return created;
	}, context);
	harness.resume();
	const started = Date.now();
	const settled = await harness.waitForTask(id, context);
	console.error(`settled in ${Date.now() - started} ms`);

	const proof = await root.commit(async (tx) => {
		const child = (await tx.scanConversations({ ownerTaskId: id }, 1)).items[0];
		if (child === undefined) return undefined;
		const submission = await tx.submissionByRequest(child.id, `ocr:${id}`);
		const entries = await tx.scanEntries({ conversationId: child.id }, 100);
		return {
			conversation: child.id,
			submission: submission?.id,
			userEntries: entries.items.filter((entry) => UserEntry.is(entry)).length,
		};
	}, context);
	console.error(`proof: ${JSON.stringify(proof)}`);
	console.error(`usage: ${JSON.stringify(await harness.usage(context))}`);

	const { outcome } = settled.state;
	if (outcome.status === "completed") console.log(JSON.stringify(outcome.result, null, 2));
	else {
		console.error(JSON.stringify(outcome, null, 2));
		process.exitCode = 1;
	}
} finally {
	await harness.close(context);
}
