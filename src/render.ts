import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type RenderOptions = {
	/** Longer side of the output image in pixels. */
	readonly maxSide: number;
};

export type PageImage = {
	readonly data: Buffer;
	readonly mimeType: "image/png";
};

/**
 * Render one 1-based page of a PDF to PNG, scaled so its longer side is `maxSide`.
 * The text layer is ignored: Bangla PDFs often carry broken or legacy (Bijoy) encodings.
 */
export async function renderPage(pdfPath: string, page: number, options: RenderOptions): Promise<PageImage> {
	const loading = getDocument({ data: new Uint8Array(await readFile(pdfPath)), verbosity: 0 });
	try {
		const doc = await loading.promise;
		const pdfPage = await doc.getPage(page);
		const base = pdfPage.getViewport({ scale: 1 });
		const viewport = pdfPage.getViewport({ scale: options.maxSide / Math.max(base.width, base.height) });
		const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		await pdfPage.render({ canvas: null, canvasContext: ctx, viewport }).promise;
		return { data: canvas.toBuffer("image/png"), mimeType: "image/png" };
	} finally {
		await loading.destroy();
	}
}
