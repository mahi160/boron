import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import { cleanScan } from "../src/clean.ts";
import { tempDir } from "./helpers/books.ts";

it("whitens a faint watermark and keeps the ink", async () => {
	const canvas = createCanvas(200, 100);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#f2ead8"; // paper
	ctx.fillRect(0, 0, 200, 100);
	ctx.fillStyle = "#d0d0d0"; // watermark
	ctx.fillRect(0, 0, 100, 100);
	ctx.fillStyle = "#202020"; // ink
	ctx.fillRect(100, 0, 100, 100);
	const path = join(await tempDir(), "page.jpg");
	await writeFile(path, await canvas.encode("jpeg", 95));

	const image = await loadImage(await cleanScan(path));
	const out = createCanvas(image.width, image.height).getContext("2d");
	out.drawImage(image, 0, 0);
	const at = (x: number) => out.getImageData(x, 50, 1, 1).data[0];
	expect(at(50)).toBeGreaterThan(245);
	expect(at(150)).toBeLessThan(20);
});
