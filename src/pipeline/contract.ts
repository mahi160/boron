import { unfence } from "../json.ts";

/** Per-page output contract shared by the OCR and proofread stages. */

export type Heading = { level: number; text: string };

/** `bbox` is [ymin, xmin, ymax, xmax] normalised to 0–1000 of the page image. */
export type Figure = { bbox: [number, number, number, number]; caption: string };

export type PageResult = {
	page: number;
	markdown: string;
	headings: Heading[];
	figures: Figure[];
	runningHeader: string;
	runningFooter: string;
	printedPageNumber: string;
	endsMidParagraph: boolean;
};

export type ParseResult = { ok: true; pages: PageResult[] } | { ok: false; error: string };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: Json | undefined): string {
	return typeof value === "string" ? value : "";
}

function headings(value: Json | undefined): Heading[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((h) =>
		isObject(h) && typeof h.level === "number" && Number.isInteger(h.level) && h.level >= 1 && h.level <= 6 && typeof h.text === "string"
			? [{ level: h.level, text: h.text }]
			: [],
	);
}

function figures(value: Json | undefined): Figure[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((f) => {
		if (!isObject(f) || !Array.isArray(f.bbox) || f.bbox.length !== 4) return [];
		const [y0, x0, y1, x1] = f.bbox;
		if (typeof y0 !== "number" || typeof x0 !== "number" || typeof y1 !== "number" || typeof x1 !== "number") return [];
		const inRange = [y0, x0, y1, x1].every((v) => v >= 0 && v <= 1000);
		if (!inRange || y1 <= y0 || x1 <= x0) return [];
		return [{ bbox: [y0, x0, y1, x1], caption: str(f.caption) }];
	});
}

/** One proofreading correction: `find` is copied from the OCR text, `replace` is what the page really says. */
export type Edit = { find: string; replace: string };

/**
 * Parse proofreading output: per page, the corrections to its OCR text. Proofreading answers with corrections only,
 * not the page again, because Bangla output tokens are most of a book's cost.
 */
export function parseProofread(text: string, requested: readonly number[]): { ok: true; pages: { page: number; edits: Edit[] }[] } | { ok: false; error: string } {
	let json: Json;
	try {
		json = JSON.parse(unfence(text));
	} catch {
		return { ok: false, error: "output is not JSON" };
	}
	const list = Array.isArray(json) ? json : isObject(json) && Array.isArray(json.pages) ? json.pages : undefined;
	if (list === undefined) return { ok: false, error: "output is not a list of pages" };
	const pages: { page: number; edits: Edit[] }[] = [];
	for (const page of requested) {
		const item = list.find((p) => isObject(p) && p.page === page);
		if (!isObject(item)) return { ok: false, error: `missing page ${page}` };
		if (!Array.isArray(item.edits)) return { ok: false, error: `page ${page} has no edits list` };
		const edits = item.edits.flatMap((e) =>
			isObject(e) && typeof e.find === "string" && e.find !== "" && typeof e.replace === "string" && e.replace !== e.find
				? [{ find: e.find, replace: e.replace }]
				: [],
		);
		pages.push({ page, edits });
	}
	return { ok: true, pages };
}

/**
 * Apply corrections in order. An edit applies only where its `find` text occurs exactly once in the current text, so a
 * vague or misquoted correction cannot change the wrong place; such edits are counted and skipped.
 */
export function applyEdits(markdown: string, edits: readonly Edit[]): { markdown: string; skipped: number } {
	let text = markdown;
	let skipped = 0;
	for (const { find, replace } of edits) {
		const at = text.indexOf(find);
		if (at === -1 || text.indexOf(find, at + 1) !== -1) {
			skipped++;
			continue;
		}
		text = text.slice(0, at) + replace + text.slice(at + find.length);
	}
	return { markdown: text, skipped };
}

/**
 * A proofreading correction and what happens to it. `auto`: a clear OCR fix, applied without asking. The others are
 * spelling-like changes a model tends to make to the author's own spelling, so a person decides; until then (`pending`)
 * the OCR text stays.
 */
export type Suggestion = Edit & {
	/** Where `find` is in the OCR text; each correction is placed once, so any subset of them applies cleanly. */
	at: number;
	status: "auto" | "pending" | "accepted" | "rejected";
};

// Letters that spell the same sound, and the signs (vowel signs, hasanta, chandrabindu, anusvara, visarga) a
// proofreader adds or drops to "correct" a spelling. A change in only these is a spelling change, not a misread letter.
const SAME_SOUND: Record<string, string> = { "\u09a3": "\u09a8", "\u09b7": "\u09b6", "\u09b8": "\u09b6", "\u0988": "\u0987", "\u098a": "\u0989" };
const SIGNS = /[\u0981-\u0983\u09bc\u09be-\u09cd\u09d7]/g;
const skeleton = (text: string) => text.replace(/[\u09a3\u09b7\u09b8\u0988\u098a]/g, (c) => SAME_SOUND[c] ?? c).replace(SIGNS, "");

/** Whether a correction only changes spelling (\u09a8/\u09a3, \u09b6/\u09b7/\u09b8, long/short vowels, added or dropped signs). */
export const isSpellingChange = (edit: Edit) => skeleton(edit.find) === skeleton(edit.replace);

/**
 * Proofreading corrections as suggestions on the OCR text: spelling changes wait for a person, the rest apply. A
 * correction whose `find` is not in the OCR text exactly once, or that overlaps an earlier one, is dropped: it cannot
 * be placed without guessing.
 */
export function toSuggestions(ocr: string, edits: readonly Edit[]): Suggestion[] {
	const placed: Suggestion[] = [];
	for (const edit of edits) {
		const at = ocr.indexOf(edit.find);
		if (at === -1 || ocr.indexOf(edit.find, at + 1) !== -1) continue;
		const end = at + edit.find.length;
		if (placed.some((p) => at < p.at + p.find.length && p.at < end)) continue;
		placed.push({ find: edit.find, replace: edit.replace, at, status: isSpellingChange(edit) ? "pending" : "auto" });
	}
	return placed;
}

/** The proofread text: the OCR text with the automatic and the accepted corrections applied at their places. */
export function proofreadText(ocr: string, suggestions: readonly Suggestion[]): string {
	const active = suggestions.filter((s) => s.status === "auto" || s.status === "accepted").toSorted((a, b) => b.at - a.at);
	// From the end backwards, so earlier places stay where they were.
	return active.reduce((text, s) => text.slice(0, s.at) + s.replace + text.slice(s.at + s.find.length), ocr);
}

/** Parse and validate model output for the requested pages; extra pages are ignored. */
export function parsePageResults(text: string, requested: readonly number[]): ParseResult {
	let json: Json;
	try {
		json = JSON.parse(unfence(text));
	} catch {
		return { ok: false, error: "output is not JSON" };
	}
	const list = Array.isArray(json) ? json : isObject(json) && Array.isArray(json.pages) ? json.pages : undefined;
	if (list === undefined) return { ok: false, error: "output is not a list of pages" };
	const pages: PageResult[] = [];
	for (const page of requested) {
		const item = list.find((p) => isObject(p) && p.page === page);
		if (!isObject(item)) return { ok: false, error: `missing page ${page}` };
		if (typeof item.markdown !== "string") return { ok: false, error: `page ${page} has no markdown` };
		pages.push({
			page,
			markdown: item.markdown,
			headings: headings(item.headings),
			figures: figures(item.figures),
			runningHeader: str(item.runningHeader),
			runningFooter: str(item.runningFooter),
			printedPageNumber: str(item.printedPageNumber),
			endsMidParagraph: item.endsMidParagraph === true,
		});
	}
	return { ok: true, pages };
}
