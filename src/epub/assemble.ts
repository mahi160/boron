import { parseNumber } from "../page-labels.ts";
import type { Figure } from "../pipeline/contract.ts";
import type { TocEntry } from "../store.ts";

/** One page's final text, as the book will use it. */
export type AssemblyPage = {
	page: number;
	markdown: string;
	runningHeader: string;
	runningFooter: string;
	printedPageNumber: string;
	/** Printed page label for the EPUB's page list (see page-labels.ts), "" if none. */
	label: string;
	endsMidParagraph: boolean;
	figures: Figure[];
};

export type Chapter = { title: string; markdown: string };
export type UsedTocEntry = TocEntry & { anchor: string; chapter: number };
export type FigureCrop = { page: number; index: number; file: string; bbox: Figure["bbox"] };
export type PageBreak = { page: number; label: string; chapter: number };

type Segment =
	| { kind: "heading"; id: string; page: number; level: number; text: string }
	| { kind: "block"; page: number; text: string }
	| { kind: "note"; text: string }
	| { kind: "break"; page: number };

/** Placeholder for the start of a printed page; writeEpub turns it into a pagebreak span. Private-use characters never occur in OCR text. */
export const breakMarker = (page: number) => `\uE000${page}\uE001`;
export const BREAK_MARKER = /\uE000(\d+)\uE001/g;

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Blocks separated by blank lines, with every heading line as its own block. */
function blocks(markdown: string): string[] {
	return markdown
		.split(/\n\s*\n/)
		.flatMap((block) => {
			const out: string[] = [];
			let lines: string[] = [];
			for (const line of block.split("\n")) {
				if (HEADING.test(line)) {
					if (lines.length > 0) out.push(lines.join("\n"));
					out.push(line);
					lines = [];
				} else lines.push(line);
			}
			if (lines.length > 0) out.push(lines.join("\n"));
			return out;
		})
		.map((b) => b.trim())
		.filter((b) => b !== "");
}

const bare = (text: string) => text.replace(/^#+\s*/, "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();

/** A block compared across pages: running headers that carry a page or chapter number differ only in digits. */
const furnitureKey = (block: string) => bare(block).replace(/[0-9\u09E6-\u09EF]+/g, "#");

/** A plain paragraph can be joined with the next page's; headings, fences, lists, tables, images cannot. */
const isParagraph = (block: string | undefined) => block !== undefined && !/^(#|:::|\||!\[|\[\^|[-*+>]\s|\d+[.)]\s)/.test(block);

const isNote = (block: string) => /^\[\^[^\]\s]+\]:/.test(block);

/**
 * Short text blocks that open (or that close) at least 3 pages and 5% of the book, digits ignored: running headers
 * and footers, and watermark or scanner credits, that the model left in the text (Tesseract pages always do).
 * Blocks ending a sentence are text, such as a short line of dialogue.
 */
function repeatedFurniture(pages: AssemblyPage[]): Set<string> {
	const needed = Math.max(3, Math.ceil(pages.length * 0.05));
	const seen = new Map<string, number>();
	const count = (edge: string, block: string | undefined) => {
		if (block === undefined || !isParagraph(block)) return;
		const key = `${edge}${furnitureKey(block)}`;
		seen.set(key, (seen.get(key) ?? 0) + 1);
	};
	for (const page of pages) {
		const list = blocks(page.markdown).filter((b) => !isNote(b));
		count("top:", list[0]);
		if (list.length > 1) count("bottom:", list[list.length - 1]);
	}
	return new Set(
		[...seen].flatMap(([edgeKey, n]) => {
			const key = edgeKey.replace(/^(top|bottom):/, "");
			return n >= needed && key.length <= 80 && /\p{L}/u.test(key) && !/[\u0964\u0965.?!"'\u201D\u2019]$/.test(key) ? [key] : [];
		}),
	);
}

/**
 * Drop leading and trailing blocks that are page furniture: the running header, footer or page number the model
 * reported, a lone page number matching the page's label, or a block repeated at the edge of many pages.
 */
function stripPageFurniture(list: string[], page: AssemblyPage, repeated: Set<string>): string[] {
	const reported = [page.runningHeader, page.runningFooter, page.printedPageNumber].map(bare).filter((t) => t !== "");
	const pageNumber = parseNumber(page.label)?.n;
	const isFurniture = (block: string | undefined) => {
		if (block === undefined) return false;
		if (reported.includes(bare(block))) return true;
		if (!isParagraph(block)) return false;
		return repeated.has(furnitureKey(block)) || (pageNumber !== undefined && parseNumber(bare(block))?.n === pageNumber);
	};
	const out = [...list];
	while (isFurniture(out[0])) out.shift();
	while (isFurniture(out[out.length - 1])) out.pop();
	return out;
}

function figureFile(page: number, index: number): string {
	return `images/fig-${String(page).padStart(4, "0")}-${index}.jpg`;
}

function pageSegments(page: AssemblyPage, figures: FigureCrop[], repeated: Set<string>): Segment[] {
	const placed = new Set<number>();
	let markdown = page.markdown
		.replace(/\[\^([^\]\s]+)\]/g, `[^p${page.page}-$1]`)
		.replace(/!\[([^\]]*)\]\(figure:(\d+)\)/g, (_, caption: string, n: string) => {
			const index = Number(n);
			if (page.figures[index] === undefined) return "";
			placed.add(index);
			return `![${caption}](${figureFile(page.page, index)})`;
		});
	page.figures.forEach((figure, index) => {
		if (!placed.has(index)) markdown += `\n\n![${figure.caption}](${figureFile(page.page, index)})`;
		figures.push({ page: page.page, index, file: figureFile(page.page, index), bbox: figure.bbox });
	});
	let heading = 0;
	const all = blocks(markdown);
	// Footnote definitions sit at the page foot; keep them out of the flow so a paragraph can continue past them.
	const notes: Segment[] = all.filter(isNote).map((text) => ({ kind: "note", text }));
	const text = stripPageFurniture(all.filter((b) => !isNote(b)), page, repeated).map((text): Segment => {
		const match = HEADING.exec(text);
		if (match === null) return { kind: "block", page: page.page, text };
		return { kind: "heading", id: `${page.page}:${heading++}`, page: page.page, level: match[1]?.length ?? 1, text: match[2] ?? "" };
	});
	return [...text, ...notes];
}

/** One TOC entry per heading the model tagged, in reading order. */
export function proposeToc(pages: AssemblyPage[]): TocEntry[] {
	const repeated = repeatedFurniture(pages);
	return pages.flatMap((page) =>
		pageSegments(page, [], repeated).flatMap((s) => (s.kind === "heading" ? [{ id: s.id, page: s.page, title: s.text, level: s.level }] : [])),
	);
}

/**
 * Turn the book's pages into chapters: strip page furniture, join paragraphs split across pages, give footnotes
 * page-unique labels and move them to the chapter end, place figures, mark where each printed page starts, and apply
 * the user's TOC (renames, levels, level 0 = not a heading, inserted `<page>:split` entries). Each level-1 heading
 * starts a chapter.
 */
export function assemble(pages: AssemblyPage[], toc: TocEntry[] | null) {
	const figures: FigureCrop[] = [];
	const entries = new Map((toc ?? []).map((e) => [e.id, e]));
	const repeated = repeatedFurniture(pages);
	const segments: Segment[] = [];
	let previous: AssemblyPage | undefined;
	for (const page of pages) {
		const split = entries.get(`${page.page}:split`);
		if (split !== undefined) segments.push({ kind: "heading", id: split.id, page: page.page, level: split.level, text: split.title });
		const own = pageSegments(page, figures, repeated);
		const last = segments.findLast((s) => s.kind !== "note");
		const first = own[0];
		const marker = page.label === "" ? "" : breakMarker(page.page);
		if (previous?.endsMidParagraph && split === undefined && last?.kind === "block" && first?.kind === "block" && isParagraph(last.text) && isParagraph(first.text)) {
			last.text = `${last.text} ${marker}${first.text}`;
			own.shift();
		} else if (marker !== "") segments.push({ kind: "break", page: page.page });
		segments.push(...own);
		previous = page;
	}

	// Text before the first chapter heading goes in an untitled front chapter, dropped below if empty.
	let current: Chapter = { title: "", markdown: "" };
	const chapters: Chapter[] = [current];
	const notes: { text: string; chapter: Chapter }[] = [];
	const used: UsedTocEntry[] = [];
	// Page starts wait for the next content, so they land in the chapter that page's text opens.
	let pending = "";
	const add = (text: string) => {
		current.markdown += isParagraph(text) ? `${pending}${text}\n\n` : `${pending === "" ? "" : `${pending}\n\n`}${text}\n\n`;
		pending = "";
	};
	for (const segment of segments) {
		if (segment.kind === "break") {
			pending += breakMarker(segment.page);
			continue;
		}
		if (segment.kind === "note") {
			notes.push({ text: segment.text, chapter: current });
			continue;
		}
		if (segment.kind === "block") {
			add(segment.text);
			continue;
		}
		const entry = entries.get(segment.id);
		const level = entry?.level ?? segment.level;
		const title = entry?.title ?? segment.text;
		if (level === 0) {
			add(`**${title}**`);
			continue;
		}
		if (level === 1 && current.markdown.trim() !== "") {
			current = { title, markdown: "" };
			chapters.push(current);
		} else if (level === 1) current.title = title;
		const anchor = `h-${segment.id.replace(":", "-")}`;
		add(`${"#".repeat(level)} ${title} {#${anchor}}`);
		used.push({ id: segment.id, page: segment.page, title, level, anchor, chapter: chapters.length - 1 });
	}
	if (pending !== "") current.markdown += `${pending}\n\n`;
	// A note belongs with its reference, which may sit in the chapter before a heading on the same page.
	const placed = notes.map((note) => {
		const ref = /^\[\^[^\]\s]+\]/.exec(note.text)?.[0];
		return { text: note.text, chapter: chapters.find((c) => ref !== undefined && c.markdown.includes(ref)) ?? note.chapter };
	});
	for (const note of placed) note.chapter.markdown += `${note.text}\n\n`;
	if (chapters[0]?.markdown.trim() === "") {
		chapters.shift();
		for (const entry of used) entry.chapter--;
	}
	const labels = new Map(pages.map((p) => [p.page, p.label]));
	const pageBreaks: PageBreak[] = chapters.flatMap((chapter, i) =>
		[...chapter.markdown.matchAll(BREAK_MARKER)].map((m) => ({ page: Number(m[1]), label: labels.get(Number(m[1])) ?? "", chapter: i })),
	);
	return { chapters, toc: used, figures, pageBreaks };
}
