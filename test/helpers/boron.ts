import { join } from "node:path";
import {
	createModels,
	fauxAssistantMessage,
	type FauxResponseFactory,
	type FauxResponseStep,
	fauxProvider,
	type Message,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { MemoryStorage, type Storage } from "@earendil-works/pi-durable";
import { type Boron, createBoron } from "../../src/boron.ts";
import { defaultSettings, type ProviderConfig, type Settings } from "../../src/settings.ts";
import { openStore, type Store } from "../../src/store.ts";
import { makePdf } from "./pdf.ts";
import { tempDir } from "./books.ts";

export function provider(id: string, limits: Partial<ProviderConfig> = {}): ProviderConfig {
	return { id, name: id.toUpperCase(), kind: "openai", login: null, baseUrl: "http://faux", apiKey: "", model: "vision", rpm: 0, rpd: 0, concurrency: 0, priceIn: null, priceOut: null, ...limits };
}

export function testSettings(overrides: Partial<Settings> = {}): Settings {
	const providers = overrides.providers ?? [provider("a")];
	const ids = providers.map((p) => p.id);
	return {
		...defaultSettings(),
		providers,
		stages: { ocr: ids, proofread: ids, assemble: ids },
		pagesPerRequest: 2,
		imageMaxSide: 800,
		quotaReset: { time: "00:00", timeZone: "UTC" },
		tesseractFallback: false,
		...overrides,
	};
}

/** Pages a request asked for, read from its "Page N" texts. */
export function requestedPages(context: TranscriptContext): number[] {
	const user = context.messages.filter((m): m is Extract<Message, { role: "user" }> => m.role === "user").at(-1);
	const content = typeof user?.content === "string" ? [] : (user?.content ?? []);
	return content.flatMap((block) => {
		const match = block.type === "text" ? /^Page (\d+)/.exec(block.text) : null;
		return match ? [Number(match[1])] : [];
	});
}

export function stageOf(context: TranscriptContext): "ocr" | "proofread" | "metadata" {
	const system = JSON.stringify(context.messages.filter((m) => m.role === "system"));
	if (system.includes("proofread")) return "proofread";
	if (system.includes("metadata")) return "metadata";
	return "ocr";
}

/** A valid answer for whatever the request asked. */
export function answer(context: TranscriptContext) {
	if (stageOf(context) === "metadata") {
		return fauxAssistantMessage(JSON.stringify({ title: "গোরা", author: "রবীন্দ্রনাথ ঠাকুর", publisher: "", year: "1910" }));
	}
	if (stageOf(context) === "proofread") {
		return fauxAssistantMessage(JSON.stringify(requestedPages(context).map((page) => ({ page, edits: [{ find: "কাঁচা", replace: "শুদ্ধ" }] }))));
	}
	return fauxAssistantMessage(JSON.stringify(requestedPages(context).map((page) => ({ page, markdown: `কাঁচা পাতা ${page}` }))));
}

export type Request = { provider: string; stage: string; pages: number[] };

/** Faux providers with the given ids, all answering through `respond`, logging every request. */
export function fauxModels(
	ids: string[],
	respond: (context: TranscriptContext, provider: string, signal: AbortSignal | undefined) => ReturnType<FauxResponseFactory>,
) {
	const requests: Request[] = [];
	const models = createModels();
	for (const id of ids) {
		const faux = fauxProvider({ provider: id, models: [{ id: "vision", input: ["text", "image"] }] });
		const step: FauxResponseStep = (context, options) => {
			requests.push({ provider: id, stage: stageOf(context), pages: requestedPages(context) });
			return respond(context, id, options?.signal);
		};
		faux.setResponses(Array.from({ length: 200 }, () => step));
		models.setProvider(faux.provider);
	}
	return { models, requests };
}

export type TestBoron = { boron: Boron; store: Store; dir: string; settings: Settings; close: () => Promise<void> };

export async function startBoron(options: {
	settings: Settings;
	models: ReturnType<typeof createModels>;
	dir?: string;
	storage?: Storage;
	tesseract?: (images: Buffer[]) => Promise<string[]>;
}): Promise<TestBoron> {
	const dir = options.dir ?? (await tempDir());
	const store = openStore(join(dir, "boron.db"));
	const boron = await createBoron({
		storage: options.storage ?? new MemoryStorage(),
		store,
		settings: () => options.settings,
		models: () => options.models,
		tesseract: options.tesseract ?? (async (images) => images.map(() => "টেসারেক্ট লেখা")),
		booksDir: join(dir, "books"),
	});
	return {
		boron,
		store,
		dir,
		settings: options.settings,
		close: async () => {
			await boron.close();
			store.close();
		},
	};
}

export async function addBook(t: TestBoron, pages: number): Promise<string> {
	return t.boron.addBook("gora.pdf", makePdf(pages));
}

/** Resolve once `check` holds after some change, or fail after `ms`. */
export function until(t: TestBoron, check: () => boolean, ms = 10_000): Promise<void> {
	return new Promise((resolve, reject) => {
		if (check()) return resolve();
		const timer = setTimeout(() => {
			clearInterval(poll);
			stop();
			reject(new Error("timed out waiting for the condition"));
		}, ms);
		const poll = setInterval(() => {
			if (check()) done();
		}, 50);
		const stop = t.boron.subscribe(() => {
			if (check()) done();
		});
		function done() {
			clearTimeout(timer);
			clearInterval(poll);
			stop();
			resolve();
		}
	});
}
