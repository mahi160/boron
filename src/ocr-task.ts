import type { TextContent } from "@earendil-works/pi-ai";
import {
	AssistantEntry,
	type ConversationId,
	configure,
	defineExtension,
	defineTask,
	type ModelRef,
} from "@earendil-works/pi-durable";
import { renderPage } from "./render.ts";

export const OCR_INSTRUCTIONS = [
	"You transcribe scanned Bangla book pages.",
	"Return only the text printed on the page, in reading order, as plain text.",
	"Keep the author's spelling, sadhu bhasha, and punctuation exactly; do not modernize or correct anything.",
	"Separate paragraphs with a blank line. Omit the running header and the page number.",
].join("\n");

export type OcrPageInput = {
	readonly pdfPath: string;
	/** 1-based page number. */
	readonly page: number;
	readonly model: ModelRef;
	/** Longer side of the rendered page image in pixels. */
	readonly maxSide: number;
};

export type OcrPageResult = {
	readonly page: number;
	readonly text: string;
	/** Task-owned conversation holding the request and the model's answer. */
	readonly conversationId: ConversationId;
};

type OcrPageState = { readonly phase: "open" } | { readonly phase: "ocr"; readonly conversationId: ConversationId };

/**
 * OCR one PDF page: create a task-owned child conversation configured for OCR, submit the rendered page image, and
 * complete with the answer text. A rerun after a crash reuses the child and its submission (same `requestId`).
 */
export const OcrPage = defineTask<OcrPageInput, OcrPageState, OcrPageResult>({
	name: "boron.ocrPage",
	version: 1,
	initial: () => ({ phase: "open" }),
	phases: {
		open: (task, runtime, context) =>
			runtime.commit(async (tx) => {
				const ownership = { kind: "task", taskId: task.id } as const;
				const existing = (await tx.scanConversations({ ownerTaskId: task.id }, 1)).items[0];
				const conversationId = existing?.id ?? (await tx.createConversation({ ownership })).id;
				if (existing === undefined) {
					await configure(tx, conversationId, {
						model: task.input.model,
						extensions: [],
						instructions: OCR_INSTRUCTIONS,
					});
				}
				return { status: "running", checkpoint: { phase: "ocr", conversationId } };
			}, context),
		ocr: async (task, runtime, context) => {
			const { conversationId } = task.state.checkpoint;
			const child = await runtime.conversation(conversationId, context);
			if (child === undefined) throw new Error(`OCR conversation ${conversationId} is missing`);
			const image = await renderPage(task.input.pdfPath, task.input.page, { maxSide: task.input.maxSide });
			const submission = await child.submit(
				{
					type: "input",
					requestId: `ocr:${task.id}`,
					content: [
						{ type: "text", text: `Page ${task.input.page}` },
						{ type: "image", data: image.data.toString("base64"), mimeType: image.mimeType },
					],
				},
				context,
			);
			const settled = await submission.wait(context);
			await runtime.commit(async (tx) => {
				if (settled.status === "unanswered") {
					const detail = { reason: settled.reason, detail: settled.detail ?? null };
					return {
						status: "terminal",
						outcome: { status: "failed", error: { message: `OCR unanswered: ${settled.reason}`, detail } },
					};
				}
				if (settled.type !== "input") throw new Error("OCR submission settled as a write");
				const answer = await tx.entry(AssistantEntry, settled.answer);
				const message = answer?.model?.find((m) => m.role === "assistant");
				if (message === undefined) throw new Error(`OCR answer ${settled.answer} has no assistant message`);
				const text = message.content
					.filter((block): block is TextContent => block.type === "text")
					.map((block) => block.text)
					.join("");
				const result: OcrPageResult = { page: task.input.page, text, conversationId };
				return { status: "terminal", outcome: { status: "completed", result } };
			}, context);
		},
	},
	abort: (_task, runtime, context) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export const BoronExtension = defineExtension({ name: "boron", tasks: [OcrPage] });
