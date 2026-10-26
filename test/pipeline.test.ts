import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetBounds } from "../src/pipeline/reset.ts";
import {
	addBook,
	answer,
	fauxModels,
	provider,
	requestedPages,
	startBoron,
	type TestBoron,
	testSettings,
	until,
} from "./helpers/boron.ts";
import { tempDir } from "./helpers/books.ts";

// Captured live from Gemini (see PLAN.md, spike findings), as pi-ai reports it.
function geminiError(quotaId: string): string {
	const inner = {
		error: {
			code: 429,
			message:
				"You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15",
			status: "RESOURCE_EXHAUSTED",
			details: [
				{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
				{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0s" },
			],
		},
	};
	return JSON.stringify({ error: { message: JSON.stringify(inner, null, 2), code: 429, status: "Too Many Requests" } });
}
const DAILY = geminiError("GenerateRequestsPerDayPerProjectPerModel-FreeTier");
const PER_MINUTE = geminiError("GenerateRequestsPerMinutePerProjectPerModel-FreeTier");
const failWith = (text: string) => fauxAssistantMessage("", { stopReason: "error", errorMessage: text });

const running: TestBoron[] = [];
afterEach(async () => {
	for (const t of running.splice(0)) await t.close();
});
async function start(...args: Parameters<typeof startBoron>) {
	const t = await startBoron(...args);
	running.push(t);
	return t;
}
const ready = (t: TestBoron, id: string) => until(t, () => t.store.book(id)?.status === "ready");

describe("book job", () => {
	it("renders, OCRs in batches of pages-per-request, proofreads, pre-fills metadata, and becomes ready", async () => {
		const { models, requests } = fauxModels(["a"], (context) => answer(context));
		const t = await start({ settings: testSettings({ pagesPerRequest: 2 }), models });
		const id = await addBook(t, 5);
		await ready(t, id);

		expect(requests.filter((r) => r.stage === "ocr").map((r) => r.pages)).toEqual(
			expect.arrayContaining([[1, 2], [3, 4], [5]]),
		);
		expect(requests.filter((r) => r.stage === "proofread")).toHaveLength(3);
		expect(requests.filter((r) => r.stage === "metadata")).toHaveLength(1);
		const pages = t.store.pages(id);
		expect(pages.map((p) => p.status)).toEqual(["done", "done", "done", "done", "done"]);
		expect(pages[2]?.raw?.markdown).toBe("কাঁচা পাতা 3");
		expect(pages[2]?.proofread?.markdown).toBe("শুদ্ধ পাতা 3");
		expect(t.store.book(id)).toMatchObject({ title: "গোরা", author: "রবীন্দ্রনাথ ঠাকুর", rendered: 5, pageCount: 5 });
	});

	it("skips proofreading when it is switched off", async () => {
		const { models, requests } = fauxModels(["a"], (context) => answer(context));
		const t = await start({ settings: testSettings({ proofread: false }), models });
		const id = await addBook(t, 2);
		await ready(t, id);
		expect(requests.some((r) => r.stage === "proofread")).toBe(false);
		expect(t.store.page(id, 1)).toMatchObject({ status: "done", proofread: null });
	});

	it("retries an invalid answer, then flags the pages for review", async () => {
		const { models, requests } = fauxModels(["a"], (context) =>
			requestedPages(context).includes(1) ? fauxAssistantMessage("দুঃখিত, পারলাম না") : answer(context),
		);
		const t = await start({ settings: testSettings({ pagesPerRequest: 1 }), models });
		const id = await addBook(t, 2);
		await ready(t, id);
		expect(requests.filter((r) => r.stage === "ocr" && r.pages[0] === 1)).toHaveLength(3);
		expect(t.store.page(id, 1)).toMatchObject({ status: "flagged", flag: expect.stringContaining("not valid") });
		expect(t.store.page(id, 2)?.status).toBe("done");
	});

	it("continues after a restart without redoing finished batches", async () => {
		const dir = await tempDir();
		const db = join(dir, "durable.sqlite");
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = fauxModels(["a"], async (context) => {
			if (requestedPages(context).includes(3)) await blocked;
			return answer(context);
		});
		const settings = testSettings({ pagesPerRequest: 2, proofread: false, stages: { ocr: ["a"], proofread: [], assemble: [] } });
		const t1 = await startBoron({ settings, models: first.models, dir, storage: await openNodeSqliteStorage(db) });
		const id = await addBook(t1, 4);
		await until(t1, () => t1.store.page(id, 1)?.status === "done" && first.requests.some((r) => r.pages.includes(3)));
		release();
		await t1.close();

		const second = fauxModels(["a"], (context) => answer(context));
		const t2 = await start({ settings, models: second.models, dir, storage: await openNodeSqliteStorage(db) });
		await ready(t2, id);
		expect(second.requests.map((r) => r.pages)).toEqual([[3, 4]]);
		expect(t2.store.pages(id).every((p) => p.status === "done")).toBe(true);
	});
});

describe("providers and limits", () => {
	it("fails over to the next provider on a daily-quota error and marks the first exhausted until the reset", async () => {
		const { models, requests } = fauxModels(["a", "b"], (context, p) => (p === "a" ? failWith(DAILY) : answer(context)));
		const settings = testSettings({ providers: [provider("a"), provider("b")], pagesPerRequest: 2, proofread: false });
		const t = await start({ settings: { ...settings, stages: { ...settings.stages, assemble: [] } }, models });
		const id = await addBook(t, 2);
		await ready(t, id);
		expect(requests.filter((r) => r.provider === "a")).toHaveLength(1);
		expect(t.store.page(id, 1)?.engine).toContain("B");
		expect(t.store.exhaustedUntil("a", Date.now())).toBe(resetBounds(Date.now(), "00:00", "UTC").next);
	});

	it("backs off after a per-minute 429 and retries the same provider", { timeout: 20_000 }, async () => {
		let failed = false;
		const { models, requests } = fauxModels(["a", "b"], (context, p) => {
			if (p === "a" && !failed) {
				failed = true;
				return failWith(PER_MINUTE);
			}
			return answer(context);
		});
		const settings = testSettings({ providers: [provider("a"), provider("b")], proofread: false, stages: { ocr: ["a", "b"], proofread: [], assemble: [] } });
		const t = await start({ settings, models });
		const id = await addBook(t, 1);
		await until(t, () => t.store.batches(id)[0]?.state === "waiting");
		expect(t.store.batches(id)[0]?.note).toContain("Rate limited");
		await ready(t, id);
		expect(requests.map((r) => r.provider)).toEqual(["a", "a"]);
	});

	it("waits for the quota reset when every provider is exhausted", async () => {
		const { models } = fauxModels(["a"], () => failWith(DAILY));
		const t = await start({ settings: testSettings({ proofread: false, stages: { ocr: ["a"], proofread: [], assemble: [] } }), models });
		const id = await addBook(t, 1);
		await until(t, () => t.store.batches(id).some((b) => b.state === "waiting"));
		const batch = t.store.batches(id)[0];
		expect(batch).toMatchObject({ state: "waiting", wakeAt: resetBounds(Date.now(), "00:00", "UTC").next });
		expect(batch?.note).toContain("out of quota");
	});

	it("falls back to Tesseract when every provider is exhausted and the setting allows it", async () => {
		const { models } = fauxModels(["a"], () => failWith(DAILY));
		const t = await start({ settings: testSettings({ tesseractFallback: true, stages: { ocr: ["a"], proofread: ["a"], assemble: [] } }), models });
		const id = await addBook(t, 1);
		await ready(t, id);
		expect(t.store.page(id, 1)).toMatchObject({ status: "done", engine: "tesseract", raw: { markdown: "টেসারেক্ট লেখা" } });
		expect(t.store.page(id, 1)?.flag).toContain("Tesseract");
	});

	it("reads the book with Tesseract when no provider is configured", async () => {
		const t = await start({ settings: testSettings({ providers: [] }), models: fauxModels([], () => failWith("")).models });
		const id = await addBook(t, 2);
		await ready(t, id);
		expect(t.store.pages(id).map((p) => p.engine)).toEqual(["tesseract", "tesseract"]);
	});

	it("keeps requests to a provider within its requests per minute", { timeout: 20_000 }, async () => {
		const { models, requests } = fauxModels(["a"], (context) => answer(context));
		const settings = testSettings({ providers: [provider("a", { rpm: 2 })], pagesPerRequest: 1, proofread: false, stages: { ocr: ["a"], proofread: [], assemble: [] } });
		const t = await start({ settings, models });
		const id = await addBook(t, 3);
		await until(t, () => requests.length === 2 && t.store.batches(id).some((b) => b.state === "waiting" && b.note?.includes("Rate limit") === true));
		await new Promise((r) => setTimeout(r, 300));
		expect(requests).toHaveLength(2);
	});
});

describe("job control", () => {
	it("pause stops the job and keeps finished pages; resume reads only the rest", async () => {
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { models, requests } = fauxModels(["a"], async (context, _provider, signal) => {
			// Like a real provider, a request in flight ends when it is aborted.
			const aborted = new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
			if (!requestedPages(context).includes(1)) await Promise.race([blocked, aborted]);
			return answer(context);
		});
		const settings = testSettings({ pagesPerRequest: 1, proofread: false, stages: { ocr: ["a"], proofread: [], assemble: [] } });
		const t = await start({ settings, models });
		const id = await addBook(t, 3);
		await until(t, () => t.store.page(id, 1)?.status === "done" && requests.length === 3);
		await t.boron.pause(id);
		await until(t, () => t.store.batches(id).filter((b) => b.state === "aborted").length === 2);
		expect(t.store.book(id)?.status).toBe("paused");
		expect(t.store.pages(id).map((p) => p.status)).toEqual(["done", "pending", "pending"]);

		release();
		await t.boron.resume(id);
		await ready(t, id);
		expect(requests.filter((r) => r.pages.includes(1))).toHaveLength(1);
		expect(t.store.pages(id).every((p) => p.status === "done")).toBe(true);
	});

	it("re-runs one page and drops its edit", async () => {
		const { models, requests } = fauxModels(["a"], (context) => answer(context));
		const t = await start({ settings: testSettings({ proofread: false }), models });
		const id = await addBook(t, 2);
		await ready(t, id);
		t.store.saveEdit(id, 2, "হাতে লেখা");
		t.store.saveEdit(id, 1, "এটা থাকবে");
		const before = requests.length;
		await t.boron.rerun(id, [2]);
		await until(t, () => t.store.batches(id).at(-1)?.state === "done");
		expect(requests.slice(before).map((r) => r.pages)).toEqual([[2]]);
		expect(t.store.page(id, 2)).toMatchObject({ edited: null, status: "done" });
		expect(t.store.page(id, 1)?.edited).toBe("এটা থাকবে");
	});

	it("refuses to re-run pages or start a second job while the book is being read", async () => {
		const blocked = new Promise<void>(() => {});
		const { models } = fauxModels(["a"], async (context, _provider, signal) => {
			await Promise.race([blocked, new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()))]);
			return answer(context);
		});
		const t = await start({ settings: testSettings({ proofread: false }), models });
		const id = await addBook(t, 2);
		await until(t, () => t.store.batches(id).some((b) => b.state === "running"));
		expect(await t.boron.rerun(id, [1])).toBe(false);
		expect(await t.boron.resume(id)).toBe(false);
		await t.boron.pause(id);
		expect(t.store.book(id)?.status).toBe("paused");
	});

	it("deletes a book with its files and rows", async () => {
		const { models } = fauxModels(["a"], (context) => answer(context));
		const t = await start({ settings: testSettings(), models });
		const id = await addBook(t, 1);
		await ready(t, id);
		await t.boron.remove(id);
		expect(t.store.book(id)).toBeUndefined();
		expect(t.store.pages(id)).toEqual([]);
		await expect(import("node:fs/promises").then((fs) => fs.access(t.boron.files.dir(id)))).rejects.toThrow();
	});
});
