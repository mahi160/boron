import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { openPdf } from "../src/render.ts";
import { samplePdf, tempDir } from "./helpers/books.ts";

describe("openPdf", () => {
	it("reports the page count and renders a page to a JPEG whose longer side is maxSide", async () => {
		const pdf = await openPdf(await samplePdf(await tempDir(), 3));
		try {
			expect(pdf.pageCount).toBe(3);
			const data = await pdf.render(2, { maxSide: 600, quality: 80 });
			expect([...data.subarray(0, 2)]).toEqual([0xff, 0xd8]);
			const decoded = await loadImage(data);
			expect([decoded.width, decoded.height]).toEqual([400, 600]);
		} finally {
			await pdf.close();
		}
	});

	it("draws the page content", async () => {
		const pdf = await openPdf(await samplePdf(await tempDir(), 1));
		const decoded = await loadImage(await pdf.render(1, { maxSide: 300, quality: 95 }));
		await pdf.close();
		const canvas = createCanvas(decoded.width, decoded.height);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(decoded, 0, 0);
		// The square spans PDF x/y 50..150 on a 200x300 page; (100, 200) from the top is inside it.
		const inside = [...ctx.getImageData(100, 200, 1, 1).data.slice(0, 3)];
		const outside = [...ctx.getImageData(10, 10, 1, 1).data.slice(0, 3)];
		expect(Math.max(...inside)).toBeLessThan(20);
		expect(Math.min(...outside)).toBeGreaterThan(235);
	});

	it("rejects a page outside the document", async () => {
		const pdf = await openPdf(await samplePdf(await tempDir(), 1));
		await expect(pdf.render(2, { maxSide: 300, quality: 80 })).rejects.toThrow();
		await pdf.close();
	});
});
