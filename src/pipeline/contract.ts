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
			printedPageNumber: str(item.printedPageNumber),
			endsMidParagraph: item.endsMidParagraph === true,
		});
	}
	return { ok: true, pages };
}
