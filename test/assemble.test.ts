import { describe, expect, it } from "vitest";
import { assemble, type AssemblyPage, BREAK_MARKER, proposeToc } from "../src/epub/assemble.ts";

const page = (n: number, markdown: string, extra: Partial<AssemblyPage> = {}): AssemblyPage => ({
	page: n,
	markdown,
	runningHeader: "",
	runningFooter: "",
	printedPageNumber: "",
	label: "",
	endsMidParagraph: false,
	figures: [],
	...extra,
});

describe("assemble", () => {
	it("strips a running header and page number the model left in the text", () => {
		const { chapters } = assemble([page(1, "গোরা\n\nপ্রথম অনুচ্ছেদ।\n\n১০", { runningHeader: "গোরা", printedPageNumber: "১০" })], null);
		expect(chapters[0]?.markdown.trim()).toBe("প্রথম অনুচ্ছেদ।");
	});

	it("strips a reported footer, a decorated page number and headers repeated on many pages", () => {
		const { chapters } = assemble(
			[
				page(1, "\u0997\u09cb\u09b0\u09be \u09e7\u09e6\n\n\u098f\u0995\u0964\n\n\u2014 \u09e7\u09e6 \u2014", { label: "\u09e7\u09e6" }),
				page(2, "\u0997\u09cb\u09b0\u09be \u09e7\u09e7\n\n\u09a6\u09c1\u0987\u0964\n\nscanned by example.org", { runningFooter: "scanned by example.org" }),
				page(3, "\u0997\u09cb\u09b0\u09be  \u09e7\u09e8\n\n\u09a4\u09bf\u09a8\u0964"),
			],
			null,
		);
		// Page 1 has a label, so its text opens with a page-start marker.
		expect(chapters[0]?.markdown.replace(BREAK_MARKER, "").trim()).toBe("\u098f\u0995\u0964\n\n\u09a6\u09c1\u0987\u0964\n\n\u09a4\u09bf\u09a8\u0964");
	});

	it("keeps a lone number that is not the page's number", () => {
		const { chapters } = assemble([page(1, "\u09e8\n\n\u0995\u09a5\u09be", { label: "\u09e7\u09e6" })], null);
		expect(chapters[0]?.markdown).toContain("\u09e8\n\n");
	});

	it("joins a paragraph across a page whose footnotes end it, and moves the notes to the chapter end", () => {
		const { chapters } = assemble(
			[page(1, "\u09ac\u09bf\u09a8\u09af\u09bc[^1] \u09ac\u09b2\u09bf\u09a4\u09c7\n\n[^1]: \u099f\u09c0\u0995\u09be\u0964", { endsMidParagraph: true }), page(2, "\u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09bf\u09b2\u0964")],
			null,
		);
		expect(chapters[0]?.markdown).toBe("\u09ac\u09bf\u09a8\u09af\u09bc[^p1-1] \u09ac\u09b2\u09bf\u09a4\u09c7 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09bf\u09b2\u0964\n\n[^p1-1]: \u099f\u09c0\u0995\u09be\u0964\n\n");
	});

	it("keeps a footnote in its reference's chapter when a chapter starts lower on the page", () => {
		const { chapters } = assemble([page(1, "# \u098f\u0995\n\n\u0995\u09a5\u09be[^1]\n\n# \u09a6\u09c1\u0987\n\n\u0986\u09b0\u0993\n\n[^1]: \u099f\u09c0\u0995\u09be")], null);
		expect(chapters[0]?.markdown).toContain("[^p1-1]: \u099f\u09c0\u0995\u09be");
		expect(chapters[1]?.markdown).not.toContain("[^p1-1]");
	});

	it("keeps short lines of dialogue that happen to open several pages", () => {
		const pages = [1, 2, 3].map((n) => page(n, "\u09a8\u09be\u0964\n\n\u0995\u09a5\u09be"));
		expect(assemble(pages, null).chapters[0]?.markdown.match(/\u09a8\u09be\u0964/g)).toHaveLength(3);
	});

	it("joins a paragraph split across a page break", () => {
		const { chapters } = assemble(
			[page(1, "এক।\n\nবিনয় বলিতে", { endsMidParagraph: true }), page(2, "চেষ্টা করিল।\n\nদুই।")],
			null,
		);
		expect(chapters[0]?.markdown).toContain("বিনয় বলিতে চেষ্টা করিল।");
		expect(chapters[0]?.markdown).toContain("\n\nদুই।");
	});

	it("does not join into a heading on the next page", () => {
		const { chapters } = assemble([page(1, "শেষ", { endsMidParagraph: true }), page(2, "# অধ্যায় দুই\n\nশুরু")], null);
		expect(chapters.map((c) => c.title)).toEqual(["", "অধ্যায় দুই"]);
		expect(chapters[0]?.markdown.trim()).toBe("শেষ");
	});

	it("gives footnotes page-unique labels so pages cannot collide", () => {
		const { chapters } = assemble([page(3, "কথা[^1]\n\n[^1]: টীকা"), page(4, "আরও[^1]\n\n[^1]: অন্য টীকা")], null);
		expect(chapters[0]?.markdown).toContain("কথা[^p3-1]");
		expect(chapters[0]?.markdown).toContain("[^p3-1]: টীকা");
		expect(chapters[0]?.markdown).toContain("আরও[^p4-1]");
	});

	it("replaces figure placeholders and appends figures the text does not place", () => {
		const figures = [
			{ bbox: [0, 0, 500, 500] as [number, number, number, number], caption: "নদী" },
			{ bbox: [500, 0, 900, 500] as [number, number, number, number], caption: "" },
		];
		const result = assemble([page(7, "আগে\n\n![নদী](figure:0)\n\nপরে", { figures })], null);
		expect(result.chapters[0]?.markdown).toContain("![নদী](images/fig-0007-0.jpg)");
		expect(result.chapters[0]?.markdown).toContain("![](images/fig-0007-1.jpg)");
		expect(result.figures).toEqual([
			{ page: 7, index: 0, file: "images/fig-0007-0.jpg", bbox: [0, 0, 500, 500] },
			{ page: 7, index: 1, file: "images/fig-0007-1.jpg", bbox: [500, 0, 900, 500] },
		]);
	});

	it("splits chapters at level-1 headings and keeps sub-headings inside", () => {
		const { chapters } = assemble(
			[page(1, "# এক\n\nক\n\n## উপ\n\nখ"), page(2, "# দুই\n\nগ")],
			null,
		);
		expect(chapters.map((c) => c.title)).toEqual(["এক", "দুই"]);
		expect(chapters[0]?.markdown).toContain('## উপ {#h-1-1}');
	});
});

describe("table of contents", () => {
	const pages = [page(1, "# এক\n\nক\n\n## উপ"), page(2, "# দুই\n\nখ"), page(3, "গ")];

	it("proposes one entry per tagged heading", () => {
		expect(proposeToc(pages)).toEqual([
			{ id: "1:0", page: 1, title: "এক", level: 1 },
			{ id: "1:1", page: 1, title: "উপ", level: 2 },
			{ id: "2:0", page: 2, title: "দুই", level: 1 },
		]);
	});

	it("applies renames, level changes, merges (level 0) and inserted splits", () => {
		const toc = [
			{ id: "1:0", page: 1, title: "প্রথম অধ্যায়", level: 1 },
			{ id: "1:1", page: 1, title: "উপ", level: 0 },
			{ id: "2:0", page: 2, title: "দুই", level: 2 },
			{ id: "3:split", page: 3, title: "তিন", level: 1 },
		];
		const { chapters, toc: used } = assemble(pages, toc);
		expect(chapters.map((c) => c.title)).toEqual(["প্রথম অধ্যায়", "তিন"]);
		expect(chapters[0]?.markdown).toContain("# প্রথম অধ্যায় {#h-1-0}");
		expect(chapters[0]?.markdown).toContain("**উপ**");
		expect(chapters[0]?.markdown).toContain("## দুই {#h-2-0}");
		expect(chapters[1]?.markdown).toContain("# তিন {#h-3-split}");
		expect(used.map((e) => e.anchor)).toEqual(["h-1-0", "h-2-0", "h-3-split"]);
	});
});
