import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Luminance at or above which a pixel becomes white, and at or below which it becomes black. */
const WHITE = 200;
const BLACK = 80;

/**
 * A grayscale copy of a page image for OCR, with light marks (faint watermarks, show-through, paper tone) turned
 * white and the ink darkened. The stored page image is left as is, so figures and the review scan keep their colour.
 */
// ponytail: fixed luminance levels; dark or coloured watermarks survive. Add per-book levels or chroma keying when needed.
export async function cleanScan(path: string): Promise<Buffer> {
	const image = await loadImage(path);
	const canvas = createCanvas(image.width, image.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	const pixels = ctx.getImageData(0, 0, image.width, image.height);
	const px = pixels.data;
	for (let i = 0; i < px.length; i += 4) {
		const luminance = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
		const value = luminance >= WHITE ? 255 : luminance <= BLACK ? 0 : ((luminance - BLACK) / (WHITE - BLACK)) * 255;
		px[i] = px[i + 1] = px[i + 2] = value;
	}
	ctx.putImageData(pixels, 0, 0);
	return canvas.encode("jpeg", 90);
}
