import { readFile } from "node:fs/promises";
import { cropFigure } from "../figures.ts";
import type { Book, PageRow } from "../store.ts";
import { pageLabels } from "../page-labels.ts";
import { type AssemblyPage, assemble } from "./assemble.ts";
import { writeEpub } from "./epub.ts";
import { textResult } from "../pipeline/contract.ts";
import { chunkText } from "../pipeline/jobs.ts";

/** A page's final text: the user's edit, else the proofread text, else the raw OCR. */
export function assemblyPages(rows: PageRow[], withFigures: boolean): AssemblyPage[] {
	const labels = pageLabels(
		rows.map((row) => ({ page: row.page, printed: row.proofread?.printedPageNumber || row.raw?.printedPageNumber || "", edited: row.pageLabel })),
	);
	return rows.flatMap((row) => {
		const result = row.proofread ?? row.raw;
		if (result === null && row.edited === null) return [];
		return [
			{
				page: row.page,
				markdown: row.edited ?? result?.markdown ?? "",
				runningHeader: result?.runningHeader ?? "",
				// Results stored before footers were reported have none.
				runningFooter: result?.runningFooter ?? "",
				printedPageNumber: result?.printedPageNumber ?? "",
				label: labels.get(row.page)?.label ?? "",
				endsMidParagraph: result?.endsMidParagraph ?? false,
				figures: withFigures ? (row.figures ?? result?.figures ?? []) : [],
			},
		];
	});
}

const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };

/** A translation book as EPUB: each chunk's Bangla (edited, else polished, else draft), its images and cover. */
export async function exportTranslation(options: {
	book: Book;
	pages: PageRow[];
	tocDepth: number;
	/** Path of an image the text references as `images/<file>`. */
	image: (file: string) => string;
	uploadedCover: string;
}): Promise<Uint8Array> {
	const { book } = options;
	const pages: AssemblyPage[] = options.pages.flatMap((row) => {
		// A chunk not translated (failed, or the model's answers were invalid) keeps its English, so no text goes missing.
		const markdown = chunkText(row) || (row.source ?? "");
		if (markdown === "") return [];
		return [{ ...textResult(row.page, markdown), label: "" }];
	});
	const { chapters, toc, pageBreaks } = assemble(pages, book.toc, { furniture: false });
	// File names as the import wrote them; one an edit made up that names no image is left out.
	const files = new Set(pages.flatMap((p) => [...p.markdown.matchAll(/!\[(?:\\.|[^\]\\])*\]\(images\/(\w[\w.-]*)\)/g)].map((m) => m[1] ?? "")));
	const images = (
		await Promise.all(
			[...files].map(async (file) => {
				const data = await readFile(options.image(file)).catch(() => null);
				const mediaType = IMAGE_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
				return data === null ? [] : [{ file: `images/${file}`, data, mediaType }];
			}),
		)
	).flat();
	const cover = book.cover.kind === "upload" ? await readFile(options.uploadedCover) : null;
	return writeEpub({ id: book.id, title: book.title, author: book.author, publisher: book.publisher, year: book.year, chapters, toc, pageBreaks, tocDepth: options.tocDepth, cover, figures: [], images });
}

export async function exportEpub(options: {
	book: Book;
	pages: PageRow[];
	tocDepth: number;
	figures: boolean;
	pageImage: (page: number) => string;
	uploadedCover: string;
}): Promise<Uint8Array> {
	const { book } = options;
	const { chapters, toc, figures, pageBreaks } = assemble(assemblyPages(options.pages, options.figures), book.toc);
	const crops = await Promise.all(
		figures.map(async (crop) => ({ crop, data: await cropFigure(options.pageImage(crop.page), crop.bbox) })),
	);
	const cover =
		book.cover.kind === "none" ? null : await readFile(book.cover.kind === "upload" ? options.uploadedCover : options.pageImage(book.cover.page));
	return writeEpub({
		id: book.id,
		title: book.title,
		author: book.author,
		publisher: book.publisher,
		year: book.year,
		chapters,
		toc,
		pageBreaks,
		tocDepth: options.tocDepth,
		cover,
		figures: crops,
	});
}
