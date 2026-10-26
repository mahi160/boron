import { describe, expect, it } from "vitest";
import { parsePageResults } from "../src/pipeline/contract.ts";

const page = (n: number, extra: object = {}) => ({
	page: n,
	markdown: `পাতা ${n}`,
	headings: [],
	figures: [],
	runningHeader: "গোরা",
	printedPageNumber: "১০",
	endsMidParagraph: false,
	...extra,
});

describe("parsePageResults", () => {
	it("accepts a JSON array inside a code fence, in requested page order", () => {
		const text = "```json\n" + JSON.stringify([page(4), page(3)]) + "\n```";
		const parsed = parsePageResults(text, [3, 4]);
		expect(parsed).toEqual({ ok: true, pages: [page(3), page(4)] });
	});

	it("accepts an object with a pages array and fills optional fields", () => {
		const parsed = parsePageResults(JSON.stringify({ pages: [{ page: 1, markdown: "x" }] }), [1]);
		expect(parsed).toEqual({
			ok: true,
			pages: [
				{
					page: 1,
					markdown: "x",
					headings: [],
					figures: [],
					runningHeader: "",
					printedPageNumber: "",
					endsMidParagraph: false,
				},
			],
		});
	});

	it("rejects output that is not JSON", () => {
		expect(parsePageResults("আমি", [1])).toMatchObject({ ok: false });
	});

	it("rejects output missing a requested page", () => {
		expect(parsePageResults(JSON.stringify([page(1)]), [1, 2])).toEqual({ ok: false, error: "missing page 2" });
	});

	it("rejects a page whose markdown is not a string", () => {
		expect(parsePageResults(JSON.stringify([page(1, { markdown: 3 })]), [1])).toMatchObject({ ok: false });
	});

	it("keeps headings with levels 1-6 and figures with valid 0-1000 boxes only", () => {
		const parsed = parsePageResults(
			JSON.stringify([
				page(1, {
					headings: [
						{ level: 1, text: "প্রথম" },
						{ level: 9, text: "bad" },
					],
					figures: [
						{ bbox: [100, 50, 400, 950], caption: "ছবি" },
						{ bbox: [500, 50, 400, 950], caption: "inverted" },
						{ bbox: [0, 0, 2000, 10] },
					],
				}),
			]),
			[1],
		);
		if (!parsed.ok) throw new Error(parsed.error);
		expect(parsed.pages[0]?.headings).toEqual([{ level: 1, text: "প্রথম" }]);
		expect(parsed.pages[0]?.figures).toEqual([{ bbox: [100, 50, 400, 950], caption: "ছবি" }]);
	});
});
