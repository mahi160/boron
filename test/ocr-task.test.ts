import { type ImageContent, fauxAssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { context, openHarness } from "../src/harness.ts";
import { OCR_INSTRUCTIONS } from "../src/ocr-task.ts";
import { fauxModels, samplePdf, startOcr, tempDir } from "./helpers/ocr.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of closers.splice(0)) await close();
});

async function harnessWith(models: Parameters<typeof openHarness>[1], settings?: Parameters<typeof openHarness>[2]) {
	const harness = await openHarness(new MemoryStorage(), models, settings);
	closers.push(() => harness.close(context));
	return harness;
}

describe("OcrPage task", () => {
	it("submits the rendered page image to a task-owned conversation and completes with the answer text", async () => {
		const requests: TranscriptContext[] = [];
		const { models, ref } = fauxModels((request) => {
			requests.push(request);
			return fauxAssistantMessage("আমি তোমায় ভালোবাসি");
		});
		const harness = await harnessWith(models);
		const pdfPath = await samplePdf(await tempDir());

		const id = await startOcr(harness, { pdfPath, page: 2, model: ref });
		const settled = await harness.waitForTask(id, context);

		expect(settled.state.outcome).toMatchObject({ status: "completed", result: { page: 2, text: "আমি তোমায় ভালোবাসি" } });
		expect(requests).toHaveLength(1);
		const system = requests[0]?.messages.filter((m) => m.role === "system");
		expect(JSON.stringify(system)).toContain(JSON.stringify(OCR_INSTRUCTIONS).slice(1, -1));
		const user = requests[0]?.messages.find((m) => m.role === "user");
		const content = typeof user?.content === "string" ? [] : (user?.content ?? []);
		const image = content.find((block): block is ImageContent => block.type === "image");
		expect(image?.mimeType).toBe("image/png");
		expect(Buffer.from(image?.data ?? "", "base64").subarray(1, 4).toString()).toBe("PNG");

		if (settled.state.outcome.status !== "completed") throw new Error("not completed");
		const child = await harness.conversation(settled.state.outcome.result.conversationId, context);
		const view = await child?.viewState(context);
		expect(view?.value.conversation.owner).toMatchObject({ taskId: id });
		view?.dispose();
	});

	it("fails with the submission's unanswered reason and provider error text", async () => {
		const { models, ref } = fauxModels(() =>
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 RESOURCE_EXHAUSTED: quota" }),
		);
		const harness = await harnessWith(models, { retry: { enabled: false } });
		const pdfPath = await samplePdf(await tempDir());

		const settled = await harness.waitForTask(await startOcr(harness, { pdfPath, page: 1, model: ref }), context);

		expect(settled.state.outcome).toMatchObject({
			status: "failed",
			error: { detail: { reason: "model_error", detail: "429 RESOURCE_EXHAUSTED: quota" } },
		});
	});

	it("runs sibling tasks concurrently", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const { models, ref } = fauxModels(async () => {
			maxInFlight = Math.max(maxInFlight, ++inFlight);
			try {
				await new Promise((resolve) => setTimeout(resolve, 500));
			} finally {
				inFlight--;
			}
			return fauxAssistantMessage("text");
		});
		const harness = await harnessWith(models);
		const pdfPath = await samplePdf(await tempDir());

		const ids = [];
		for (let i = 0; i < 10; i++) ids.push(await startOcr(harness, { pdfPath, page: (i % 3) + 1, model: ref }));
		await Promise.all(ids.map((id) => harness.waitForTask(id, context)));

		expect(maxInFlight).toBe(10);
	});
});
