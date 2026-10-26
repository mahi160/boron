import { describe, expect, it } from "vitest";
import { assemble, type AssemblyPage, proposeToc } from "../src/epub/assemble.ts";

const page = (n: number, markdown: string, extra: Partial<AssemblyPage> = {}): AssemblyPage => ({
	page: n,
	markdown,
	runningHeader: "",
	printedPageNumber: "",
	endsMidParagraph: false,
	figures: [],
	...extra,
});

describe("assemble", () => {
	it("strips a running header and page number the model left in the text", () => {
		const { chapters } = assemble([page(1, "গোরা\n\nপ্রথম অনুচ্ছেদ।\n\n১০", { runningHeader: "গোরা", printedPageNumber: "১০" })], null);
		expect(chapters[0]?.markdown.trim()).toBe("প্রথম অনুচ্ছেদ।");
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
