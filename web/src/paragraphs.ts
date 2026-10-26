/**
 * The review editor's compact form of page Markdown: one line per paragraph, without the blank lines Markdown needs
 * between paragraphs. Verse fences, tables and lists keep their own lines. Only used when the round trip is exact.
 */

const blocks = (markdown: string) =>
	markdown
		.split(/\n\s*\n/)
		.map((b) => b.trim())
		.filter((b) => b !== "");

const isTableLine = (line: string) => line.startsWith("|");
const isListLine = (line: string) => /^([-*+]|\d+[.)])\s/.test(line);

/** Compact text back to Markdown: each line outside a fence, table or list is its own paragraph. */
export function expand(text: string): string {
	const out: string[] = [];
	let fence: string[] | null = null;
	for (const raw of text.split("\n")) {
		const line = raw.trimEnd();
		if (fence !== null) {
			fence.push(line);
			if (line.trim() === ":::") {
				out.push(fence.join("\n"));
				fence = null;
			}
			continue;
		}
		if (line.trim() === "") continue;
		if (line.startsWith(":::")) {
			fence = [line];
			continue;
		}
		const previous = out[out.length - 1];
		const last = previous?.split("\n").at(-1) ?? "";
		const continues = (isTableLine(line) && isTableLine(last)) || (isListLine(line) && isListLine(last));
		if (previous !== undefined && continues) out[out.length - 1] = `${previous}\n${line}`;
		else out.push(line);
	}
	if (fence !== null) out.push(fence.join("\n"));
	return out.join("\n\n");
}

/** Markdown with its paragraphs separated by exactly one blank line, as `expand` writes it. */
export const normalize = (markdown: string) => blocks(markdown).join("\n\n");

/** The compact form of `markdown`, or null if it would not turn back into the same Markdown. */
export function compact(markdown: string): string | null {
	const text = blocks(markdown).join("\n");
	return expand(text) === normalize(markdown) ? text : null;
}
