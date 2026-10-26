const number = new Intl.NumberFormat("en");

export const count = (n: number) => number.format(n);

const dollars = new Intl.NumberFormat("en", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** "$0.0123": up to four decimals, since one page costs fractions of a cent. */
export const usd = (n: number) => dollars.format(n);

/** "in 3 h 12 m", "in 45 s", "now". */
export function until(at: number, now: number): string {
	const s = Math.max(0, Math.round((at - now) / 1000));
	if (s === 0) return "now";
	if (s < 60) return `in ${s} s`;
	const m = Math.round(s / 60);
	if (m < 60) return `in ${m} m`;
	return `in ${Math.floor(m / 60)} h ${m % 60} m`;
}

export const clock = (at: number) =>
	new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const date = (at: number) => new Date(at).toISOString().slice(0, 10);

/** "1, 2, 3, 7" → "1–3, 7". */
export function pageRanges(pages: number[]): string {
	const out: string[] = [];
	for (let i = 0; i < pages.length; i++) {
		const start = pages[i];
		let end = start;
		while (pages[i + 1] === (end ?? 0) + 1) end = pages[++i];
		out.push(start === end ? `${start}` : `${start}–${end}`);
	}
	return out.join(", ");
}
