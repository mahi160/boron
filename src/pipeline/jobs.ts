import { readFile } from "node:fs/promises";
import type { UserInput } from "@earendil-works/pi-durable";
import { cleanScan } from "../clean.ts";
import { isObj, parseJson, unfence } from "../json.ts";
import type { Settings, Stage } from "../settings.ts";
import type { GlossaryEntry, PageRow } from "../store.ts";
import { type PageResult, parsePageResults, parseProofread, proofreadText, type Suggestion, textResult, toSuggestions } from "./contract.ts";
import type { Deps } from "./deps.ts";
import {
	GLOSSARY_CONTRACT,
	METADATA_CONTRACT,
	NO_FIGURES,
	PAGE_CONTRACT,
	POLISH_CONTRACT,
	PROOFREAD_CONTRACT,
	TRANSLATE_CONTRACT,
} from "./prompts.ts";

/**
 * A batch reads pages (OCR, then proofread), reads the title pages for metadata, translates one chunk of a
 * translation book (translate, then polish), or makes a translation book's glossary.
 */
export type Job = "pages" | "metadata" | "translate" | "glossary";

/** One model request of a job. Translation steps use the proofread stage's providers. */
export type Step = Stage | "translate" | "polish" | "glossary";

export function providerStage(step: Step): Stage {
	return step === "translate" || step === "polish" || step === "glossary" ? "proofread" : step;
}

export function firstStep(job: Job): Step {
	return job === "metadata" ? "assemble" : job === "translate" ? "translate" : job === "glossary" ? "glossary" : "ocr";
}

export type BookMetadata = { title: string; author: string; publisher: string; year: string };

export type Parsed =
	/** `suggestions`: for proofread pages, the corrections the result was made from, by page. */
	| { ok: true; pages: PageResult[]; suggestions?: Map<number, Suggestion[]> }
	| { ok: true; metadata: BookMetadata }
	| { ok: true; glossary: GlossaryEntry[] }
	| { ok: false; error: string };

/** Steps a job runs, in order, under the current settings. */
export function jobStages(job: Job, settings: Settings): Step[] {
	if (job === "metadata") return ["assemble"];
	if (job === "glossary") return ["glossary"];
	if (job === "translate") return settings.polish ? ["translate", "polish"] : ["translate"];
	return settings.proofread ? ["ocr", "proofread"] : ["ocr"];
}

export function instructions(stage: Step, settings: Settings): string {
	const figures = settings.figures ? "" : `\n${NO_FIGURES}`;
	if (stage === "translate") return `${settings.prompts.translate}\n\n${TRANSLATE_CONTRACT}`;
	if (stage === "polish") return `${settings.prompts.polish}\n\n${POLISH_CONTRACT}`;
	if (stage === "glossary") return `${settings.prompts.glossary}\n\n${GLOSSARY_CONTRACT}`;
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

const quoted = (label: string, text: string) => `${label}, between the markers:\n<<<\n${text}\n>>>`;

function glossaryText(glossary: GlossaryEntry[] | null): string {
	if (glossary === null || glossary.length === 0) return "Glossary: none.";
	return `Glossary (English \u2192 Bangla):\n${glossary.map((g) => `- ${g.en} \u2192 ${g.bn}`).join("\n")}`;
}

/** A chunk's current Bangla: the user's edit, else the polished text, else the draft. */
export function chunkText(row: PageRow | undefined): string {
	return row?.edited ?? row?.proofread?.markdown ?? row?.raw?.markdown ?? "";
}

/** The user message of a translation step for one chunk: glossary, context and the text to work on. */
function translationContent(deps: Deps, bookId: string, stage: "translate" | "polish", page: number): string {
	const { store } = deps;
	const row = store.page(bookId, page);
	const parts = [`Chunk ${page}`, glossaryText(store.book(bookId)?.glossary ?? null)];
	if (stage === "translate") {
		const previous = chunkText(store.page(bookId, page - 1));
		if (previous !== "") parts.push(quoted("The previous chunk's Bangla translation, for context only", previous));
		parts.push(quoted("The English chunk to translate", row?.source ?? ""));
	} else {
		parts.push(quoted("The English chunk", row?.source ?? ""), quoted("The draft Bangla translation to revise", row?.raw?.markdown ?? ""));
	}
	return parts.join("\n\n");
}

/** The user message for one request: each page's number, (for proofread) its OCR text, and its image. */
export async function requestContent(deps: Deps, bookId: string, stage: Step, pages: number[]): Promise<UserInput> {
	if (stage === "translate" || stage === "polish") return pages.map((page) => translationContent(deps, bookId, stage, page)).join("\n\n");
	if (stage === "glossary") {
		// ponytail: the whole book in one request; split into parts if books outgrow the models' context.
		const text = deps.store.pages(bookId).map((p) => p.source ?? "").join("\n\n");
		return quoted("The English book", text);
	}
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

function parseGlossary(text: string): Parsed {
	const value = parseJson(unfence(text));
	const list = Array.isArray(value) ? value : isObj(value) && Array.isArray(value.glossary) ? value.glossary : undefined;
	if (list === undefined) return { ok: false, error: "glossary is not a JSON list" };
	const glossary = list.flatMap((g: unknown) =>
		isObj(g) && typeof g.en === "string" && typeof g.bn === "string" && g.en.trim() !== "" && g.bn.trim() !== ""
			? [{ en: g.en.trim(), bn: g.bn.trim() }]
			: [],
	);
	return { ok: true, glossary };
}

// Alt text may hold escaped brackets.
const imageLinks = (markdown: string) => [...markdown.matchAll(/!\[(?:\\.|[^\]\\])*\]\(([^)\s]+)\)/g)].map((m) => m[1]).sort();

/** A translated chunk: its Markdown, which must keep every image of the English in place. */
function parseTranslation(text: string, page: number, row: PageRow | undefined): Parsed {
	const markdown = (/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/.exec(text.trim())?.[1] ?? text).trim();
	if (markdown === "") return { ok: false, error: "the translation is empty" };
	if (row?.source == null) return { ok: false, error: `chunk ${page} has no English text` };
	if (imageLinks(markdown).join("\n") !== imageLinks(row.source).join("\n")) return { ok: false, error: "the translation lost or changed an image" };
	return { ok: true, pages: [textResult(page, markdown)] };
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

export function parseAnswer(job: Job, stage: Step, text: string, pages: number[], row: (page: number) => PageRow | undefined): Parsed {
	if (job === "metadata") return parseMetadata(text);
	if (job === "glossary") return parseGlossary(text);
	if (job === "translate") {
		// One chunk per request: the previous chunk's translation is the next one's context.
		const [page] = pages;
		return page === undefined ? { ok: false, error: "no chunk" } : parseTranslation(text, page, row(page));
	}
	return stage === "proofread" ? proofreadPages(text, pages, (page) => row(page)?.raw ?? null) : parsePageResults(text, pages);
}
