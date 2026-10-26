import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Figure } from "./pipeline/contract.ts";

/** Crop a figure from a page image. `bbox` is [ymin, xmin, ymax, xmax] in 0–1000 of the image. */
export async function cropFigure(pageImage: string, bbox: Figure["bbox"]): Promise<Buffer> {
	const image = await loadImage(pageImage);
	const [y0, x0, y1, x1] = bbox;
	const sx = Math.round((x0 / 1000) * image.width);
	const sy = Math.round((y0 / 1000) * image.height);
	const sw = Math.max(1, Math.round(((x1 - x0) / 1000) * image.width));
	const sh = Math.max(1, Math.round(((y1 - y0) / 1000) * image.height));
	const canvas = createCanvas(sw, sh);
	canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
	return canvas.encode("jpeg", 90);
}
