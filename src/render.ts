import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type RenderOptions = {
	/** Longer side of the output image in pixels. */
	readonly maxSide: number;
	/** JPEG quality, 1–100. */
	readonly quality: number;
};

/** Number of pages of a PDF; rejects if it cannot be opened. */
export async function pdfPageCount(data: Uint8Array): Promise<number> {
	// pdf.js takes ownership of the buffer it is given; keep the caller's.
	const loading = getDocument({ data: data.slice(), verbosity: 0 });
	try {
		return (await loading.promise).numPages;
	} finally {
		await loading.destroy();
	}
}

/**
 * Open a PDF for rendering. Pages are always rendered to images; the text layer is never used, because Bangla PDFs
 * often carry broken or legacy (Bijoy) encodings.
 */
export async function openPdf(path: string) {
	const loading = getDocument({ data: new Uint8Array(await readFile(path)), verbosity: 0 });
	const doc = await loading.promise.catch(async (error: unknown) => {
		await loading.destroy();
		throw error;
	});
	return {
		pageCount: doc.numPages,
		/** Render one 1-based page to JPEG, scaled so its longer side is `maxSide`. */
		async render(page: number, options: RenderOptions): Promise<Buffer> {
			const pdfPage = await doc.getPage(page);
			try {
				const base = pdfPage.getViewport({ scale: 1 });
				const viewport = pdfPage.getViewport({ scale: options.maxSide / Math.max(base.width, base.height) });
				const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
				const ctx = canvas.getContext("2d");
				ctx.fillStyle = "#fff";
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				await pdfPage.render({ canvas: null, canvasContext: ctx, viewport }).promise;
				return canvas.encode("jpeg", options.quality);
			} finally {
				pdfPage.cleanup();
			}
		},
		close: () => loading.destroy(),
	};
}
