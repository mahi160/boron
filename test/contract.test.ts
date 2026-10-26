import { describe, expect, it } from "vitest";
import { applyEdits, decideSuggestions, parsePageResults, parseProofread, proofreadText, toSuggestions } from "../src/pipeline/contract.ts";

describe("proofreading suggestions", () => {
	const ocr = "\u09b8\u09be\u09a7\u09be\u09b0\u09a8 \u0995\u09be\u09b2 \u09b2\u09cb\u0995 \u0995\u09be\u09b2";
	it("places each correction once in the OCR text, so any subset applies", () => {
		const s = toSuggestions(ocr, [
			{ find: "\u09b8\u09be\u09a7\u09be\u09b0\u09a8", replace: "\u09b8\u09be\u09a7\u09be\u09b0\u09a3" },
			{ find: "\u09a8 \u0995\u09be\u09b2", replace: "\u09a8 \u0995\u09be\u09ae" }, // overlaps the first: dropped
			{ find: "\u0995\u09be\u09b2", replace: "\u0995\u09be\u09ae" }, // twice in the text: dropped
			{ find: "\u09b2\u09cb\u0995 \u0995\u09be\u09b2", replace: "\u09b2\u09cb\u0995 \u0995\u09be\u09ae" },
		]);
		expect(s.map((x) => [x.at, x.status])).toEqual([[0, "pending"], [11, "auto"]]);
		expect(proofreadText(ocr, s)).toBe("\u09b8\u09be\u09a7\u09be\u09b0\u09a8 \u0995\u09be\u09b2 \u09b2\u09cb\u0995 \u0995\u09be\u09ae");
		const accepted = s.map((x) => ({ ...x, status: x.status === "pending" ? ("accepted" as const) : x.status }));
		expect(proofreadText(ocr, accepted)).toBe("\u09b8\u09be\u09a7\u09be\u09b0\u09a3 \u0995\u09be\u09b2 \u09b2\u09cb\u0995 \u0995\u09be\u09ae");
	});

	it("applies and undoes a decision in the user's edited text, and refuses where it cannot", () => {
		const result = (markdown: string) => ({ page: 1, markdown, headings: [], figures: [], runningHeader: "", runningFooter: "", printedPageNumber: "", endsMidParagraph: false });
		const suggestions = toSuggestions("cat sat", [{ find: "cat", replace: "cut" }]).map((s) => ({ ...s, status: "pending" as const }));
		const row = { raw: result("cat sat"), proofread: result("cat sat"), suggestions, edited: "cat sat!" };
		const accepted = decideSuggestions(row, [{ index: 0, find: "cat", status: "accepted" }]);
		if ("error" in accepted) throw new Error(accepted.error);
		expect([accepted.proofread.markdown, accepted.edited]).toEqual(["cut sat", "cut sat!"]);
		const undone = decideSuggestions({ ...row, ...accepted }, [{ index: 0, find: "cat", status: "rejected" }]);
		if ("error" in undone) throw new Error(undone.error);
		expect([undone.proofread.markdown, undone.edited]).toEqual(["cat sat", "cat sat!"]);
		expect(decideSuggestions({ ...row, edited: "dog" }, [{ index: 0, find: "cat", status: "accepted" }])).toHaveProperty("error");
		expect(decideSuggestions(row, [{ index: 0, find: "dog", status: "accepted" }])).toEqual({ error: "The suggestions of this page changed; reload it" });
	});
});

describe("proofreading corrections", () => {
	it("parses the corrections of every requested page", () => {
		const text = JSON.stringify([{ page: 2, edits: [{ find: "\u0995\u09be\u09b2", replace: "\u0995\u09be\u09b2\u09cb" }, { find: "" }] }, { page: 1, edits: [] }]);
		expect(parseProofread(text, [1, 2])).toEqual({ ok: true, pages: [{ page: 1, edits: [] }, { page: 2, edits: [{ find: "\u0995\u09be\u09b2", replace: "\u0995\u09be\u09b2\u09cb" }] }] });
		expect(parseProofread(JSON.stringify([{ page: 1 }]), [1])).toEqual({ ok: false, error: "page 1 has no edits list" });
	});

	it("applies an edit only where its text occurs exactly once", () => {
		const result = applyEdits("\u098f\u0995 \u09a6\u09c1\u0987 \u098f\u0995", [
			{ find: "\u09a6\u09c1\u0987", replace: "\u09a4\u09bf\u09a8" },
			{ find: "\u098f\u0995", replace: "X" },
			{ find: "\u09aa\u09be\u0981\u099a", replace: "Y" },
		]);
		expect(result).toEqual({ markdown: "\u098f\u0995 \u09a4\u09bf\u09a8 \u098f\u0995", skipped: 2 });
	});
});

const page = (n: number, extra: object = {}) => ({
	page: n,
	markdown: `পাতা ${n}`,
	headings: [],
	figures: [],
	runningHeader: "গোরা",
	runningFooter: "বিশ্বভারতী",
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
					runningFooter: "",
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
