import { describe, expect, it } from "vitest";
import { pageLabels } from "../src/page-labels.ts";

const input = (printed: string[], edited: Record<number, string> = {}) =>
	printed.map((p, i) => ({ page: i + 1, printed: p, edited: edited[i + 1] ?? null }));

describe("pageLabels", () => {
	it("keeps printed labels and counts unnumbered pages from their neighbours, in the same digits", () => {
		const labels = pageLabels(input(["", "", "১", "", "৩", "", "xii"]));
		expect([...labels].map(([page, l]) => [page, l.label, l.source])).toEqual([
			[3, "১", "printed"],
			[5, "৩", "printed"],
			[7, "xii", "printed"],
			[4, "২", "inferred"],
			[6, "৪", "inferred"],
		]);
	});

	it("counts front matter back from the first numbered page, never below 1", () => {
		const labels = pageLabels(input(["", "", "2"]));
		expect(labels.get(2)).toEqual({ label: "1", source: "inferred" });
		expect(labels.has(1)).toBe(false);
	});

	it("reads decorated numbers and lets the user's label win, an empty one meaning none", () => {
		const labels = pageLabels(input(["— ১০ —", "", "", ""], { 3: "", 4: "50" }));
		expect(labels.get(2)).toEqual({ label: "১১", source: "inferred" });
		expect(labels.has(3)).toBe(false);
		expect(labels.get(4)).toEqual({ label: "50", source: "edited" });
	});
});
