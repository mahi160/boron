import { readFile } from "node:fs/promises";
import type { UserInput } from "@earendil-works/pi-durable";
import { cleanScan } from "../clean.ts";
import { isObj, parseJson, unfence } from "../json.ts";
import type { Settings, Stage } from "../settings.ts";
import { type PageResult, parsePageResults, parseProofread, proofreadText, type Suggestion, toSuggestions } from "./contract.ts";
import type { Deps } from "./deps.ts";
import { METADATA_CONTRACT, NO_FIGURES, PAGE_CONTRACT, PROOFREAD_CONTRACT } from "./prompts.ts";

/** A batch either reads pages (OCR, then proofread) or reads the title pages for metadata. */
export type Job = "pages" | "metadata";

export type BookMetadata = { title: string; author: string; publisher: string; year: string };

export type Parsed =
	/** `suggestions`: for proofread pages, the corrections the result was made from, by page. */
	| { ok: true; pages: PageResult[]; suggestions?: Map<number, Suggestion[]> }
	| { ok: true; metadata: BookMetadata }
	| { ok: false; error: string };

/** Stages a job runs, in order, under the current settings. */
export function jobStages(job: Job, settings: Settings): Stage[] {
	if (job === "metadata") return ["assemble"];
	return settings.proofread ? ["ocr", "proofread"] : ["ocr"];
}

export function instructions(stage: Stage, settings: Settings): string {
	const figures = settings.figures ? "" : `\n${NO_FIGURES}`;
	if (stage === "assemble") return `${settings.prompts.metadata}\n\n${METADATA_CONTRACT}`;
	if (stage === "proofread") return `${settings.prompts.proofread}\n\n${PROOFREAD_CONTRACT}`;
	return `${settings.prompts[stage]}\n\n${PAGE_CONTRACT}${figures}`;
}

/** The page image OCR reads: the rendered scan, cleaned of light marks when the setting is on. */
export function ocrImage(deps: Deps, bookId: string, page: number): Promise<Buffer> {
	const path = deps.pageImage(bookId, page);
	return deps.settings().cleanScans ? cleanScan(path) : readFile(path);
}

async function image(deps: Deps, bookId: string, page: number) {
	const data = await ocrImage(deps, bookId, page);
	return { type: "image" as const, data: data.toString("base64"), mimeType: "image/jpeg" };
}

/** The user message for one request: each page's number, (for proofread) its OCR text, and its image. */
export async function requestContent(deps: Deps, bookId: string, stage: Stage, pages: number[]): Promise<UserInput> {
	const content: Exclude<UserInput, string> = [];
	for (const page of pages) {
		let text = `Page ${page}`;
		if (stage === "proofread") {
			// Verbatim, not JSON-escaped, so corrections can quote it exactly.
			const raw = deps.store.page(bookId, page)?.raw;
			text += `\nOCR text of page ${page}, between the markers:\n<<<\n${raw?.markdown ?? ""}\n>>>`;
		}
		content.push({ type: "text", text }, await image(deps, bookId, page));
	}
	return content;
}

function parseMetadata(text: string): Parsed {
	const value = parseJson(unfence(text));
	if (!isObj(value)) return { ok: false, error: "metadata is not a JSON object" };
	const field = (key: string) => {
		const v = value[key];
		return typeof v === "string" ? v.trim() : "";
	};
	return {
		ok: true,
		metadata: { title: field("title"), author: field("author"), publisher: field("publisher"), year: field("year") },
	};
}

/** Proofread pages: each page's OCR result with the corrections applied to its text. */
function proofreadPages(text: string, pages: number[], raw: (page: number) => PageResult | null): Parsed {
	const parsed = parseProofread(text, pages);
	if (!parsed.ok) return parsed;
	const results: PageResult[] = [];
	const suggestions = new Map<number, Suggestion[]>();
	for (const { page, edits } of parsed.pages) {
		const ocr = raw(page);
		if (ocr === null) return { ok: false, error: `page ${page} has no OCR text to proofread` };
		// ponytail: corrections that cannot be placed are dropped silently; flag the page if they turn out common.
		const list = toSuggestions(ocr.markdown, edits);
		suggestions.set(page, list);
		results.push({ ...ocr, markdown: proofreadText(ocr.markdown, list) });
	}
	return { ok: true, pages: results, suggestions };
}

export function parseAnswer(job: Job, stage: Stage, text: string, pages: number[], raw: (page: number) => PageResult | null): Parsed {
	if (job === "metadata") return parseMetadata(text);
	return stage === "proofread" ? proofreadPages(text, pages, raw) : parsePageResults(text, pages);
}
