/** Printed page labels ("১০", "xii") per PDF page: the user's, else the printed one, else inferred from neighbours. */

export type PageLabel = { label: string; source: "edited" | "printed" | "inferred" };

/** `printed`: the number the model read ("" if none). `edited`: the user's label, "" meaning "no label", null if not set. */
export type LabelInput = { page: number; printed: string; edited: string | null };

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** The page number in a label of only Bangla or only Latin digits, allowing decoration such as "— ১০ —" or "(10)". */
export function parseNumber(label: string): { n: number; bangla: boolean } | null {
	const match = /^[\s\-–—().[\]]*(?:([0-9]+)|([০-৯]+))[\s\-–—().[\]]*$/.exec(label);
	if (match === null) return null;
	if (match[1] !== undefined) return { n: Number(match[1]), bangla: false };
	const latin = [...(match[2] ?? "")].map((d) => BANGLA_DIGITS.indexOf(d)).join("");
	return { n: Number(latin), bangla: true };
}

const format = (n: number, bangla: boolean) =>
	bangla ? [...String(n)].map((d) => BANGLA_DIGITS[Number(d)]).join("") : String(n);

/**
 * Unlabelled pages (chapter openings, plates) take the numbering of the nearest numbered page before them, or for
 * front matter of the first numbered page after them, as long as that gives a number of at least 1.
 */
export function pageLabels(pages: LabelInput[]): Map<number, PageLabel> {
	const labels = new Map<number, PageLabel>();
	type Anchor = { offset: number; bangla: boolean };
	const anchors = new Map<number, Anchor>();
	for (const { page, printed, edited } of pages) {
		const own = edited ?? printed.trim();
		if (own === "") continue;
		labels.set(page, { label: own, source: edited === null ? "printed" : "edited" });
		const parsed = parseNumber(own);
		if (parsed !== null) anchors.set(page, { offset: parsed.n - page, bangla: parsed.bangla });
	}
	const infer = (list: LabelInput[]) => {
		let anchor: Anchor | undefined;
		for (const { page, edited } of list) {
			const own = anchors.get(page);
			if (own !== undefined) anchor = own;
			// A page the user marked as unlabelled stays so.
			if (labels.has(page) || edited !== null || anchor === undefined || page + anchor.offset < 1) continue;
			labels.set(page, { label: format(page + anchor.offset, anchor.bangla), source: "inferred" });
		}
	};
	infer(pages);
	infer([...pages].reverse());
	return labels;
}
