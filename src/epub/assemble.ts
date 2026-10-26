import type { Figure } from "../pipeline/contract.ts";
import type { TocEntry } from "../store.ts";

/** One page's final text, as the book will use it. */
export type AssemblyPage = {
	page: number;
	markdown: string;
	runningHeader: string;
	printedPageNumber: string;
	endsMidParagraph: boolean;
	figures: Figure[];
};

export type Chapter = { title: string; markdown: string };
export type UsedTocEntry = TocEntry & { anchor: string; chapter: number };
export type FigureCrop = { page: number; index: number; file: string; bbox: Figure["bbox"] };

type Segment = { kind: "heading"; id: string; page: number; level: number; text: string } | { kind: "block"; page: number; text: string };

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

const bare = (text: string) => text.replace(/^#+\s*/, "").replace(/[*_]/g, "").trim();

/** Drop leading and trailing blocks that only repeat the running header or the printed page number. */
function stripPageFurniture(list: string[], page: AssemblyPage): string[] {
	const furniture = [page.runningHeader, page.printedPageNumber].map((t) => t.trim()).filter((t) => t !== "");
	const isFurniture = (block: string | undefined) => block !== undefined && furniture.includes(bare(block));
	const out = [...list];
	while (isFurniture(out[0])) out.shift();
	while (isFurniture(out[out.length - 1])) out.pop();
	return out;
}

/** A plain paragraph can be joined with the next page's; headings, fences, lists, tables, images cannot. */
const isParagraph = (block: string | undefined) => block !== undefined && !/^(#|:::|\||!\[|\[\^|[-*+>]\s|\d+[.)]\s)/.test(block);

function figureFile(page: number, index: number): string {
	return `images/fig-${String(page).padStart(4, "0")}-${index}.jpg`;
}

function pageSegments(page: AssemblyPage, figures: FigureCrop[]): Segment[] {
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
	return stripPageFurniture(blocks(markdown), page).map((text) => {
		const match = HEADING.exec(text);
		if (match === null) return { kind: "block", page: page.page, text };
		return { kind: "heading", id: `${page.page}:${heading++}`, page: page.page, level: match[1]?.length ?? 1, text: match[2] ?? "" };
	});
}

/** One TOC entry per heading the model tagged, in reading order. */
export function proposeToc(pages: AssemblyPage[]): TocEntry[] {
	return pages.flatMap((page) =>
		pageSegments(page, []).flatMap((s) => (s.kind === "heading" ? [{ id: s.id, page: s.page, title: s.text, level: s.level }] : [])),
	);
}

/**
 * Turn the book's pages into chapters: strip page furniture, join paragraphs split across pages, give footnotes
 * page-unique labels, place figures, and apply the user's TOC (renames, levels, level 0 = not a heading, inserted
 * `<page>:split` entries). Each level-1 heading starts a chapter.
 */
export function assemble(pages: AssemblyPage[], toc: TocEntry[] | null) {
	const figures: FigureCrop[] = [];
	const entries = new Map((toc ?? []).map((e) => [e.id, e]));
	const segments: Segment[] = [];
	let previous: AssemblyPage | undefined;
	for (const page of pages) {
		const split = entries.get(`${page.page}:split`);
		if (split !== undefined) segments.push({ kind: "heading", id: split.id, page: page.page, level: split.level, text: split.title });
		const own = pageSegments(page, figures);
		const last = segments[segments.length - 1];
		const first = own[0];
		if (previous?.endsMidParagraph && split === undefined && last?.kind === "block" && first?.kind === "block" && isParagraph(last.text) && isParagraph(first.text)) {
			last.text = `${last.text} ${first.text}`;
			own.shift();
		}
		segments.push(...own);
		previous = page;
	}

	// Text before the first chapter heading goes in an untitled front chapter, dropped below if empty.
	let current: Chapter = { title: "", markdown: "" };
	const chapters: Chapter[] = [current];
	const used: UsedTocEntry[] = [];
	for (const segment of segments) {
		if (segment.kind === "block") {
			current.markdown += `${segment.text}\n\n`;
			continue;
		}
		const entry = entries.get(segment.id);
		const level = entry?.level ?? segment.level;
		const title = entry?.title ?? segment.text;
		if (level === 0) {
			current.markdown += `**${title}**\n\n`;
			continue;
		}
		if (level === 1 && current.markdown.trim() !== "") {
			current = { title, markdown: "" };
			chapters.push(current);
		} else if (level === 1) current.title = title;
		const anchor = `h-${segment.id.replace(":", "-")}`;
		current.markdown += `${"#".repeat(level)} ${title} {#${anchor}}\n\n`;
		used.push({ id: segment.id, page: segment.page, title, level, anchor, chapter: chapters.length - 1 });
	}
	if (chapters[0]?.markdown.trim() === "") {
		chapters.shift();
		for (const entry of used) entry.chapter--;
	}
	return { chapters, toc: used, figures };
}
