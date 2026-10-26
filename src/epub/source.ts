import { posix } from "node:path";
import { strFromU8, unzipSync } from "fflate";

/** Reading an uploaded EPUB: package metadata, cover, images, and the spine as Markdown. */

export type EpubImage = { file: string; data: Uint8Array; mediaType: string };

export type SourceEpub = {
	title: string;
	author: string;
	/** The cover image as stored in the EPUB, or null if it names none. */
	cover: EpubImage | null;
	/** Images the text references, as `images/<file>` in the Markdown. */
	images: EpubImage[];
	/** The whole spine as Markdown: one paragraph-level block per blank-line-separated block. */
	markdown: string;
};

export class EpubError extends Error {}

type Attrs = Record<string, string>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d" };

function decode(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
		if (name[0] === "#") {
			const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

function attrs(source: string): Attrs {
	const out: Attrs = {};
	for (const m of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
		if (m[1] !== undefined) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? "");
	}
	return out;
}

/** Elements of `xml` named `tag` (with or without a namespace prefix): their attributes and inner text. */
function elements(xml: string, tag: string): { attrs: Attrs; text: string }[] {
	const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}\\s*>)`, "gi");
	return [...xml.matchAll(re)].map((m) => ({ attrs: attrs(m[1] ?? ""), text: decode((m[2] ?? "").replace(/<[^>]*>/g, "")).trim() }));
}

/** A path inside the zip from an href relative to the file `base`. */
function resolve(base: string, href: string): string {
	const raw = href.split("#")[0] ?? "";
	let path: string;
	try {
		path = decodeURIComponent(raw);
	} catch {
		throw new EpubError(`The EPUB names a file with a malformed path: ${raw.slice(0, 100)}`);
	}
	return posix.normalize(posix.join(posix.dirname(base), path)).replace(/^\/+/, "");
}

const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp" };

const BLOCKS = new Set(["p", "div", "section", "article", "header", "footer", "aside", "main", "body", "li", "ul", "ol", "dd", "dt", "dl", "figure", "figcaption", "blockquote", "pre", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]);
const SKIP = new Set(["head", "script", "style", "title"]);

/** Escape what would otherwise read as Markdown syntax in plain text. */
function escapeText(text: string): string {
	return text.replace(/([\\`*_[\]])/g, "\\$1");
}
function escapeBlockStart(text: string): string {
	return text.replace(/^(#|>|[-+]\s)/, "\\$1").replace(/^(\d+)([.)]\s)/, "$1\\$2");
}

/**
 * XHTML to Markdown blocks: headings, paragraphs, bold, italic, line breaks, lists, block quotes and images. Links
 * keep their text; tables become one line per row.
 */
export function xhtmlToMarkdown(xhtml: string, image: (src: string) => string | null): string[] {
	const out: string[] = [];
	// Open inline emphasis, innermost last; the bottom frame is the block's own text.
	let inline: { marker: string; text: string }[] = [{ marker: "", text: "" }];
	let heading = 0;
	let quote = 0;
	const lists: ("ul" | "ol")[] = [];
	let item = false;
	let skip = 0;
	const top = () => inline[inline.length - 1] ?? { marker: "", text: "" };
	const flush = () => {
		while (inline.length > 1) closeInline();
		const text = (inline[0]?.text ?? "")
			.replace(/[ \t\r\n\u00a0]+/g, " ")
			.replace(/^[ \uE002]+|[ \uE002]+$/g, "")
			// A heading is one line: a break in it is a space.
			.replace(/ ?\uE002 ?/g, heading > 0 ? " " : "\\\n");
		inline = [{ marker: "", text: "" }];
		if (text === "") return;
		let block = heading > 0 ? `${"#".repeat(heading)} ${text}` : escapeBlockStart(text);
		if (item) block = `${lists.at(-1) === "ol" ? "1." : "-"} ${block}`;
		if (quote > 0) block = block.split("\n").map((line) => `${"> ".repeat(quote)}${line}`).join("\n");
		out.push(block);
	};
	function closeInline() {
		const frame = inline.pop();
		if (frame === undefined) return;
		const trimmed = frame.text.trim();
		const lead = /^\s*/.exec(frame.text)?.[0] ?? "";
		const trail = /\s*$/.exec(frame.text)?.[0] ?? "";
		top().text += trimmed === "" ? frame.text : `${lead}${frame.marker}${trimmed}${frame.marker}${trail}`;
	}
	for (const m of xhtml.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g)) {
		const [, cdata, closing, rawName, rawAttrs, selfClosing, text] = m;
		if (text !== undefined || cdata !== undefined) {
			if (skip === 0) top().text += escapeText(cdata ?? decode(text ?? ""));
			continue;
		}
		if (rawName === undefined) continue;
		const name = rawName.toLowerCase().replace(/^\w+:/, "");
		if (SKIP.has(name)) {
			if (selfClosing) continue;
			skip += closing ? -1 : 1;
			continue;
		}
		if (skip > 0) continue;
		const open = closing !== "/";
		if (name === "br") {
			// A placeholder, so collapsing whitespace keeps it; it becomes a Markdown hard break.
			top().text += "\uE002";
		} else if (name === "img" || name === "image") {
			const a = attrs(rawAttrs ?? "");
			const file = image(a.src ?? a.href ?? a["xlink:href"] ?? "");
			if (file !== null) {
				flush();
				out.push(`![${escapeText((a.alt ?? "").replace(/\s+/g, " ").trim())}](${file})`);
			}
		} else if (name === "hr" && open) {
			flush();
			out.push("* * *");
		} else if (name === "em" || name === "i" || name === "cite" || name === "strong" || name === "b") {
			if (selfClosing) continue;
			if (open) inline.push({ marker: name === "strong" || name === "b" ? "**" : "*", text: "" });
			else if (inline.length > 1) closeInline();
		} else if (name === "td" || name === "th") {
			if (!open) top().text += " | ";
		} else if (BLOCKS.has(name)) {
			flush();
			if (selfClosing) continue;
			const level = /^h([1-6])$/.exec(name)?.[1];
			if (level !== undefined) heading = open ? Number(level) : 0;
			else if (name === "blockquote") quote += open ? 1 : -1;
			else if (name === "ul" || name === "ol") {
				if (open) lists.push(name);
				else lists.pop();
			} else if (name === "li") item = open;
		}
	}
	flush();
	return out.map((block) => block.replace(/ \|$/gm, ""));
}

/** Read an EPUB's package, metadata, cover and spine. Throws `EpubError` for a file that is not a readable EPUB. */
export function readEpub(data: Uint8Array): SourceEpub {
	let zip: Record<string, Uint8Array>;
	try {
		zip = unzipSync(data);
	} catch {
		throw new EpubError("That file is not an EPUB (it is not a zip archive)");
	}
	const text = (path: string) => {
		const file = zip[path];
		if (file === undefined) throw new EpubError(`The EPUB is missing ${path}`);
		return strFromU8(file);
	};
	const opfPath = elements(text("META-INF/container.xml"), "rootfile")[0]?.attrs["full-path"];
	if (opfPath === undefined) throw new EpubError("The EPUB's container.xml names no package file");
	const opf = text(opfPath);
	const manifest = new Map(
		elements(opf, "item").map(({ attrs: a }) => [a.id ?? "", { path: resolve(opfPath, a.href ?? ""), type: a["media-type"] ?? "", properties: a.properties ?? "" }]),
	);
	const spine = elements(opf, "itemref").flatMap(({ attrs: a }) => {
		const item = manifest.get(a.idref ?? "");
		return item !== undefined && /html/.test(item.type) ? [item.path] : [];
	});
	if (spine.length === 0) throw new EpubError("The EPUB has no text documents in its spine");

	const imageType = (path: string) => [...manifest.values()].find((i) => i.path === path)?.type || IMAGE_TYPES[posix.extname(path).toLowerCase()] || "";
	const images = new Map<string, EpubImage>();
	/** The Markdown path of an image in the zip, carried into the output. */
	const imageFile = (path: string): string | null => {
		const known = images.get(path);
		if (known !== undefined) return `images/${known.file}`;
		const data = zip[path];
		const mediaType = imageType(path);
		if (data === undefined || !mediaType.startsWith("image/")) return null;
		const file = `${images.size + 1}-${posix.basename(path).replace(/[^\w.-]/g, "_")}`;
		images.set(path, { file, data, mediaType });
		return `images/${file}`;
	};

	const coverId = elements(opf, "meta").find((m) => m.attrs.name === "cover")?.attrs.content;
	const coverItem = [...manifest.values()].find((i) => i.properties.split(/\s+/).includes("cover-image")) ?? (coverId === undefined ? undefined : manifest.get(coverId));
	const coverData = coverItem === undefined ? undefined : zip[coverItem.path];
	const cover = coverItem !== undefined && coverData !== undefined ? { file: posix.basename(coverItem.path), data: coverData, mediaType: coverItem.type } : null;

	const blocks: string[] = [];
	for (const path of spine) {
		const doc = text(path);
		// A page that only shows the cover image is not part of the text.
		const own = xhtmlToMarkdown(doc, (src) => {
			if (src === "" || /^[a-z]+:/i.test(src)) return null;
			const resolved = resolve(path, src);
			return coverItem !== undefined && resolved === coverItem.path ? "cover" : imageFile(resolved);
		});
		blocks.push(...own.filter((b) => !b.endsWith("](cover)")));
	}
	// Chapters are the top heading level used; books that title chapters with <h2> get them as level 1.
	const levels = blocks.flatMap((b) => (/^(#{1,6}) /.exec(b)?.[1]?.length ?? []));
	const shift = levels.length === 0 ? 0 : Math.min(...levels) - 1;
	const markdown = blocks.map((b) => (shift > 0 && /^#{1,6} /.test(b) ? b.slice(shift) : b)).join("\n\n");
	const meta = (tag: string) => elements(opf, tag)[0]?.text ?? "";
	return { title: meta("title"), author: meta("creator"), cover, images: [...images.values()], markdown };
}

const words = (text: string) => text.split(/\s+/).filter((w) => w !== "").length;

/** Split Markdown into chunks of about `size` words at block boundaries; a block longer than `size` is a chunk of its own. */
export function chunkMarkdown(markdown: string, size: number): string[] {
	const chunks: string[] = [];
	let current: string[] = [];
	let count = 0;
	for (const block of markdown.split(/\n{2,}/)) {
		if (block.trim() === "") continue;
		const n = words(block);
		if (current.length > 0 && count + n > size) {
			chunks.push(current.join("\n\n"));
			current = [];
			count = 0;
		}
		current.push(block);
		count += n;
	}
	if (current.length > 0) chunks.push(current.join("\n\n"));
	return chunks;
}
