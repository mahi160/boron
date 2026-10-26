import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { renderPage } from "../src/render.ts";
import { samplePdf, tempDir } from "./helpers/ocr.ts";

describe("renderPage", () => {
	it("renders the requested page to a PNG whose longer side is maxSide", async () => {
		const path = await samplePdf(await tempDir(), 3);
		const image = await renderPage(path, 2, { maxSide: 600 });
		expect(image.mimeType).toBe("image/png");
		const decoded = await loadImage(image.data);
		expect(decoded.height).toBe(600);
		expect(decoded.width).toBe(400);
	});

	it("draws the page content", async () => {
		const path = await samplePdf(await tempDir(), 1);
		const image = await renderPage(path, 1, { maxSide: 300 });
		const decoded = await loadImage(image.data);
		const canvas = createCanvas(decoded.width, decoded.height);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(decoded, 0, 0);
		// Square spans PDF x/y 50..150 on a 200x300 page; (100, 200) from the top is inside it.
		expect([...ctx.getImageData(100, 200, 1, 1).data.slice(0, 3)]).toEqual([0, 0, 0]);
		expect([...ctx.getImageData(10, 10, 1, 1).data.slice(0, 3)]).toEqual([255, 255, 255]);
	});

	it("rejects a page outside the document", async () => {
		const path = await samplePdf(await tempDir(), 1);
		await expect(renderPage(path, 2, { maxSide: 300 })).rejects.toThrow();
	});
});
