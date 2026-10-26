import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import {
	type ConversationId,
	configure,
	defineTask,
	type RunningTask,
	type TaskRuntime,
	LiveDoc,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { prices } from "../models.ts";
import type { ProviderConfig } from "../settings.ts";
import { textResult } from "./contract.ts";
import type { Deps } from "./deps.ts";
import { classifyError, errorMessage } from "./errors.ts";
import { firstStep, instructions, type Job, jobStages, ocrImage, parseAnswer, providerStage, requestContent, type Step } from "./jobs.ts";
import { resetBounds } from "./reset.ts";

export type BatchInput = { bookId: string; batchId: number; pages: number[]; job: Job };

type Attempt = {
	stage: Step;
	/** Providers that failed this stage with a non-quota error; tried last-resort only by Tesseract. */
	skip: string[];
	/** After a per-minute 429 the batch retries the same provider instead of failing over. */
	pinned: string | null;
	/** Invalid answers so far in this stage. */
	invalid: number;
};

type BatchState = ({ phase: "pick" } & Attempt) | ({ phase: "request"; provider: string; conversationId: ConversationId } & Attempt);

type Runtime = TaskRuntime<BatchInput, BatchState, null, object>;
type Task<P extends BatchState["phase"]> = RunningTask<BatchInput, Extract<BatchState, { phase: P }>, null>;

/** A model may answer badly twice; the third invalid answer flags the pages for review. */
const MAX_INVALID = 3;

/** Steps whose text the pages cannot do without: when they fail, the pages fail. The others keep the earlier step's text. */
const required = (step: Step) => step === "ocr" || step === "translate";
/** Jobs whose pages are book text, marked done or failed with the job. */
const hasPages = (job: Job) => job === "pages" || job === "translate";

function attempt(state: BatchState): Attempt {
	return { stage: state.stage, skip: state.skip, pinned: state.pinned, invalid: state.invalid };
}

function answerText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/**
 * OCR (then proofread) a few pages, or read the title pages for metadata. Each model request picks the first
 * provider of the stage that is not exhausted, takes a limiter slot, and runs in its own task-owned conversation.
 */
export function createBatchTask(deps: Deps) {
	const { store, limiter } = deps;

	function setBatch(task: { input: BatchInput }, patch: Parameters<typeof store.updateBatch>[1]) {
		store.updateBatch(task.input.batchId, patch);
		deps.changed(task.input.bookId);
	}

	async function sleep(task: Task<BatchState["phase"]>, runtime: Runtime, until: number, next: BatchState, note: string, context: Context) {
		setBatch(task, { state: "waiting", wakeAt: until, note });
		await runtime.sleepUntil(until, next, context);
	}

	function pick(task: Task<BatchState["phase"]>, runtime: Runtime, next: Attempt, context: Context) {
		return runtime.commit(() => ({ status: "running", checkpoint: { phase: "pick", ...next } }), context);
	}

	async function finish(task: Task<BatchState["phase"]>, runtime: Runtime, context: Context) {
		const { bookId, pages, job } = task.input;
		if (hasPages(job)) {
			for (const page of pages) if (store.page(bookId, page)?.status === "pending") store.markPage(bookId, page, "done", null);
		}
		setBatch(task, { state: "done", wakeAt: null, note: null });
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
	}

	/** Go on to the batch's next stage, or finish. */
	async function advance(task: Task<BatchState["phase"]>, runtime: Runtime, context: Context) {
		const stages = jobStages(task.input.job, deps.settings());
		const next = stages[stages.indexOf(task.state.checkpoint.stage) + 1];
		if (next === undefined) return finish(task, runtime, context);
		return pick(task, runtime, { stage: next, skip: [], pinned: null, invalid: 0 }, context);
	}

	async function fail(task: Task<BatchState["phase"]>, runtime: Runtime, reason: string, context: Context) {
		const { bookId, pages, job } = task.input;
		if (hasPages(job)) for (const page of pages) store.markPage(bookId, page, "failed", reason);
		setBatch(task, { state: "failed", wakeAt: null, note: reason });
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
	}

	async function runTesseract(task: Task<"pick">, runtime: Runtime, context: Context) {
		const { bookId, pages } = task.input;
		setBatch(task, { state: "running", stage: "ocr", provider: "tesseract", wakeAt: null, note: null });
		const texts = await deps.tesseract(await Promise.all(pages.map((page) => ocrImage(deps, bookId, page))));
		pages.forEach((page, i) => {
			store.saveResult(bookId, textResult(page, texts[i] ?? ""), "ocr", "tesseract", true);
			store.markPage(bookId, page, "done", "Read by Tesseract; re-run with a model for better text");
		});
		// Proofreading needs a model; Tesseract pages skip it.
		return finish(task, runtime, context);
	}

	/** Nothing can serve this stage now. */
	async function noProvider(task: Task<"pick">, runtime: Runtime, configured: ProviderConfig[], wake: number | undefined, context: Context) {
		const { stage, skip } = task.state.checkpoint;
		const settings = deps.settings();
		const ocrFallback = stage === "ocr" && task.input.job === "pages" && (configured.length === 0 || settings.tesseractFallback);
		if (ocrFallback) return runTesseract(task, runtime, context);
		if (!required(stage) && (configured.length === 0 || wake === undefined)) {
			// No model for proofread, polish, metadata or the glossary (or all of them failed): keep what the earlier stage produced.
			if ((stage === "proofread" || stage === "polish") && skip.length > 0) {
				const flag = stage === "polish" ? "Polish failed; showing the draft" : "Proofread failed; showing raw OCR";
				for (const page of task.input.pages) store.markPage(task.input.bookId, page, "done", flag);
			}
			return finish(task, runtime, context);
		}
		if (wake === undefined) {
			const reason = stage === "translate" ? "No translation provider could translate this chunk" : "Every OCR provider failed for these pages";
			return fail(task, runtime, reason, context);
		}
		const reset = new Date(wake).toISOString();
		return sleep(task, runtime, wake, task.state.checkpoint, `All providers are out of quota until ${reset}`, context);
	}

	return defineTask<BatchInput, BatchState, null>({
		name: "boron.batch",
		version: 1,
		initial: (input) => ({ phase: "pick", stage: firstStep(input.job), skip: [], pinned: null, invalid: 0 }),
		phases: {
			pick: async (task, runtime, context) => {
				const settings = deps.settings();
				const state = task.state.checkpoint;
				const stage = state.stage;
				const configured = settings.stages[providerStage(stage)].flatMap((id) => settings.providers.find((p) => p.id === id) ?? []);
				const usable = configured.filter((p) => !state.skip.includes(p.id));
				const ordered = [...usable.filter((p) => p.id === state.pinned), ...usable.filter((p) => p.id !== state.pinned)];
				const now = deps.now();
				let wake: number | undefined;
				for (const provider of ordered) {
					const exhausted = store.exhaustedUntil(provider.id, now);
					if (exhausted !== null) {
						wake = Math.min(wake ?? exhausted, exhausted);
						continue;
					}
					const slot = limiter.acquire(provider, task.id, settings.quotaReset);
					if (slot.ok) {
						await runtime.commit(async (tx) => {
							const conversation = await tx.createConversation({ ownership: { kind: "task", taskId: task.id } });
							await configure(tx, conversation.id, {
								model: { provider: provider.id, modelId: provider.model },
								extensions: [],
								instructions: instructions(stage, settings),
							});
							return {
								status: "running",
								checkpoint: { phase: "request", ...attempt(state), provider: provider.id, conversationId: conversation.id },
							};
						}, context);
						return;
					}
					if (slot.reason === "rpd") {
						store.setExhausted(provider.id, slot.until, "daily request limit");
						wake = Math.min(wake ?? slot.until, slot.until);
						continue;
					}
					const note = slot.reason === "rpm" ? `Rate limit of ${provider.name}` : `Waiting for a free ${provider.name} slot`;
					return sleep(task, runtime, slot.until, state, note, context);
				}
				return noProvider(task, runtime, configured, wake, context);
			},

			request: async (task, runtime, context) => {
				const { bookId, batchId, job, pages } = task.input;
				const state = task.state.checkpoint;
				const provider = deps.settings().providers.find((p) => p.id === state.provider);
				limiter.hold(state.provider, task.id);
				const settled = await (async () => {
					setBatch(task, { state: "running", stage: state.stage, provider: state.provider, wakeAt: null, note: null });
					const child = await runtime.conversation(state.conversationId, context);
					if (child === undefined) throw new Error(`request conversation ${state.conversationId} is missing`);
					const submission = await child.submit(
						{
							type: "input",
							requestId: `batch:${task.id}:${state.conversationId}`,
							content: await requestContent(deps, bookId, state.stage, pages),
						},
						context,
					);
					// pi-durable retries transient errors (503s) itself; show its backoff on the batch.
					const watch = await runtime.watchDoc(LiveDoc, state.conversationId, context);
					watch?.start(async (live) => {
						const retry = live?.generation?.retry;
						if (retry !== undefined) setBatch(task, { state: "retrying", wakeAt: retry.at, note: errorMessage(retry.error).slice(0, 300) });
					});
					return submission.wait(context).finally(() => watch?.stop());
				})().finally(() => limiter.release(task.id));

				if (settled.status === "unanswered") {
					const text = typeof settled.detail === "string" ? settled.detail : settled.reason;
					const error = classifyError(text);
					if (error.kind === "rate") {
						const next: BatchState = { phase: "pick", ...attempt(state), pinned: state.provider };
						return sleep(task, runtime, deps.now() + error.retryAfterMs, next, `Rate limited by ${provider?.name ?? state.provider}`, context);
					}
					if (error.kind === "quota") {
						const { timeZone, time } = deps.settings().quotaReset;
						store.setExhausted(state.provider, resetBounds(deps.now(), time, timeZone).next, "quota exhausted");
						return pick(task, runtime, { ...attempt(state), pinned: null }, context);
					}
					setBatch(task, { note: `${provider?.name ?? state.provider} failed: ${errorMessage(text).slice(0, 300)}` });
					return pick(task, runtime, { ...attempt(state), skip: [...state.skip, state.provider], pinned: null }, context);
				}

				const { messages } = await runtime.context(state.conversationId, context);
				const answer = messages.findLast((m): m is AssistantMessage => m.role === "assistant");
				if (answer === undefined) throw new Error(`answer of batch ${batchId} is missing`);
				// Anthropic reports prompt-cached input apart from `input`; it is input all the same.
				const { input, output, cacheRead, cacheWrite } = answer.usage;
				store.addTokens(batchId, input + cacheRead + cacheWrite, output);
				if (provider !== undefined) {
					const price = prices(provider);
					store.logUsage({
						request: `batch:${task.id}:${state.conversationId}`,
						bookId,
						provider: provider.name,
						model: provider.model,
						stage: state.stage,
						inputTokens: input + cacheRead + cacheWrite,
						outputTokens: output,
						cost: (input * price.input + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + output * price.output) / 1_000_000,
						at: deps.now(),
					});
				}
				const parsed = parseAnswer(job, state.stage, answerText(answer), pages, (page) => store.page(bookId, page));
				if (!parsed.ok) {
					const invalid = state.invalid + 1;
					if (invalid < MAX_INVALID) return pick(task, runtime, { ...attempt(state), pinned: state.provider, invalid }, context);
					const must = required(state.stage);
					if (hasPages(job)) {
						const flag = must
							? `The model's answer was not valid (${parsed.error})`
							: state.stage === "polish"
								? "Polish failed; showing the draft"
								: "Proofread failed; showing raw OCR";
						for (const page of pages) store.markPage(bookId, page, must ? "flagged" : "done", flag);
					}
					return must ? finish(task, runtime, context) : advance(task, runtime, context);
				}
				const engine = `${provider?.name ?? state.provider} · ${provider?.model ?? ""}`;
				if ("glossary" in parsed) {
					// The user may have made one while this ran; theirs stays.
					if (store.book(bookId)?.glossary === null) store.updateBook(bookId, { glossary: parsed.glossary });
				} else if ("pages" in parsed) {
					for (const result of parsed.pages) {
						// A draft translation is stored as the OCR text is, the polished one as the proofread text.
						const stage = state.stage === "proofread" || state.stage === "polish" ? "proofread" : "ocr";
						store.saveResult(bookId, result, stage, engine, false, parsed.suggestions?.get(result.page) ?? null);
					}
				}
				else {
					const book = store.book(bookId);
					const m = parsed.metadata;
					// Never overwrite what the user typed.
					if (book !== undefined && book.author === "") {
						store.updateBook(bookId, {
							title: m.title || book.title,
							author: m.author,
							publisher: m.publisher || book.publisher,
							year: m.year || book.year,
						});
					}
				}
				deps.changed(bookId);
				return advance(task, runtime, context);
			},
		},
		abort: async (task, runtime, context) => {
			limiter.release(task.id);
			setBatch(task, { state: "aborted", wakeAt: null });
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
		},
	});
}

export type BatchTask = ReturnType<typeof createBatchTask>;
