import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exportEpub } from "../src/epub/export.ts";
import type { PageResult } from "../src/pipeline/contract.ts";
import type { Book, PageRow } from "../src/store.ts";
import { tempDir } from "./helpers/books.ts";

const result = (page: number, markdown: string, extra: Partial<PageResult> = {}): PageResult => ({
	page,
	markdown,
	headings: [],
	figures: [],
	runningHeader: "",
	runningFooter: "",
	printedPageNumber: "",
	endsMidParagraph: false,
	...extra,
});

const row = (page: number, raw: PageResult, extra: Partial<PageRow> = {}): PageRow => ({
	bookId: "b1",
	page,
	status: "done",
	raw,
	proofread: null,
	edited: null,
	figures: null,
	engine: "test",
	flag: null,
	pageLabel: null,
	...extra,
});

const book: Book = {
	id: "0b6a3c62-6f0e-4b8e-9d55-0d8f8a1f6a11",
	fileName: "gora.pdf",
	title: "গোরা",
	author: "রবীন্দ্রনাথ ঠাকুর",
	publisher: "বিশ্বভারতী",
	year: "1910",
	pageCount: 3,
	rendered: 3,
	status: "ready",
	taskId: null,
	cover: { kind: "page", page: 1 },
	toc: null,
	error: null,
	createdAt: 0,
};

async function pageImage(dir: string): Promise<string> {
	const canvas = createCanvas(200, 300);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, 200, 300);
	const path = join(dir, "page.jpg");
	await writeFile(path, await canvas.encode("jpeg", 90));
	return path;
}

describe("exportEpub", () => {
	it("writes an EPUB 3 with chapters, nav, metadata, cover, figures and the Bangla font", async () => {
		const image = await pageImage(await tempDir());
		const pages = [
			row(1, result(1, "# প্রথম পরিচ্ছেদ\n\nশ্রাবণ মাসের শেষ[^1]।\n\n[^1]: টীকা।")),
			row(2, result(2, "::: verse\nপ্রথম লাইন\nদ্বিতীয় লাইন\n:::\n\n![নদী](figure:0)", {
				figures: [{ bbox: [100, 100, 500, 900], caption: "নদী" }],
			})),
			row(3, result(3, "# দ্বিতীয় পরিচ্ছেদ\n\n| ক | খ |\n|---|---|\n| ১ | ২ |"), { edited: "# দ্বিতীয় পরিচ্ছেদ\n\nসম্পাদিত **লেখা**।" }),
		];
		const zip = unzipSync(
			await exportEpub({ book, pages, tocDepth: 2, figures: true, pageImage: () => image, uploadedCover: "" }),
		);
		const text = (name: string) => strFromU8(zip[name] ?? new Uint8Array());

		expect(Object.keys(zip)[0]).toBe("mimetype");
		expect(text("mimetype")).toBe("application/epub+zip");
		expect(Object.keys(zip)).toEqual(
			expect.arrayContaining([
				"OEBPS/ch001.xhtml",
				"OEBPS/ch002.xhtml",
				"OEBPS/nav.xhtml",
				"OEBPS/cover.jpg",
				"OEBPS/images/fig-0002-0.jpg",
				"OEBPS/fonts/noto-serif-bengali-400.woff",
			]),
		);
		const opf = text("OEBPS/content.opf");
		expect(opf).toContain("<dc:title>গোরা</dc:title>");
		expect(opf).toContain("<dc:creator id=\"author\">রবীন্দ্রনাথ ঠাকুর</dc:creator>");
		expect(opf).toContain("<dc:language>bn</dc:language>");
		expect(opf).toContain('properties="cover-image"');

		const ch1 = text("OEBPS/ch001.xhtml");
		expect(ch1).toContain('<h1 id="h-1-0">প্রথম পরিচ্ছেদ</h1>');
		expect(ch1).toContain('class="footnote-ref"');
		expect(ch1).toContain('<div class="verse">');
		expect(ch1).toContain('<img src="images/fig-0002-0.jpg" alt="নদী" />');
		const ch2 = text("OEBPS/ch002.xhtml");
		expect(ch2).toContain("সম্পাদিত <strong>লেখা</strong>।");
		expect(text("OEBPS/nav.xhtml")).toContain('<a href="ch002.xhtml#h-3-0">দ্বিতীয় পরিচ্ছেদ</a>');
	});

	it("marks where each printed page starts and lists the pages in the nav", async () => {
		const image = await pageImage(await tempDir());
		const pages = [
			row(1, result(1, "")),
			row(2, result(2, "# \u0985\u09a7\u09cd\u09af\u09be\u09af\u09bc\n\n\u0995\u09a5\u09be", { endsMidParagraph: true })),
			row(3, result(3, "\u099a\u09b2\u09bf\u09b2\u0964\n\n\u09e9", { printedPageNumber: "\u09e9" })),
		];
		const zip = unzipSync(await exportEpub({ book, pages, tocDepth: 2, figures: true, pageImage: () => image, uploadedCover: "" }));
		const text = (name: string) => strFromU8(zip[name] ?? new Uint8Array());
		const ch1 = text("OEBPS/ch001.xhtml");
		// Page 2 is counted back from page 3; page 1 would be page 1 but has no text, so it marks the same spot.
		expect(ch1).toContain('<span epub:type="pagebreak" role="doc-pagebreak" id="page-2" aria-label="\u09e8"></span><h1');
		expect(ch1).toContain('\u0995\u09a5\u09be <span epub:type="pagebreak" role="doc-pagebreak" id="page-3" aria-label="\u09e9"></span>\u099a\u09b2\u09bf\u09b2\u0964</p>');
		expect(ch1).not.toContain("<p>\u09e9</p>");
		const nav = text("OEBPS/nav.xhtml");
		expect(nav).toContain('<nav epub:type="page-list"');
		expect(nav).toContain('<a href="ch001.xhtml#page-3">\u09e9</a>');
	});

	it("renders pipe tables", async () => {
		const image = await pageImage(await tempDir());
		const zip = unzipSync(
			await exportEpub({
				book,
				pages: [row(1, result(1, "| ক | খ |\n|---|---|\n| ১ | ২ |"))],
				tocDepth: 2,
				figures: true,
				pageImage: () => image,
				uploadedCover: "",
			}),
		);
		expect(strFromU8(zip["OEBPS/ch001.xhtml"] ?? new Uint8Array())).toContain("<td>১</td>");
	});
});
