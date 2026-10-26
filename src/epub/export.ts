import { readFile } from "node:fs/promises";
import { cropFigure } from "../figures.ts";
import type { Book, PageRow } from "../store.ts";
import { pageLabels } from "../page-labels.ts";
import { type AssemblyPage, assemble } from "./assemble.ts";
import { writeEpub } from "./epub.ts";

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
	const cover = await readFile(book.cover.kind === "upload" ? options.uploadedCover : options.pageImage(book.cover.page));
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
