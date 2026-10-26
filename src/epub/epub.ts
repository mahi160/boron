import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { strToU8, type Zippable, zipSync } from "fflate";
import MarkdownIt from "markdown-it";
import container from "markdown-it-container";
import footnote from "markdown-it-footnote";
import type { Chapter, FigureCrop, UsedTocEntry } from "./assemble.ts";

export type EpubInput = {
	id: string;
	title: string;
	author: string;
	publisher: string;
	year: string;
	chapters: Chapter[];
	toc: UsedTocEntry[];
	tocDepth: number;
	cover: Buffer;
	/** Cropped image of each figure the chapters reference. */
	figures: { crop: FigureCrop; data: Buffer }[];
};

const md = new MarkdownIt({ html: false, xhtmlOut: true, linkify: false, typographer: false })
	.use(footnote)
	.use(container, "verse");

// `## Title {#anchor}` sets the heading's id, as in Pandoc.
md.core.ruler.push("heading_ids", (state) => {
	state.tokens.forEach((token, i) => {
		if (token.type !== "heading_open") return;
		const inline = state.tokens[i + 1];
		const match = inline && /\s*\{#([\w-]+)\}\s*$/.exec(inline.content);
		if (!inline || !match?.[1]) return;
		token.attrSet("id", match[1]);
		inline.content = inline.content.slice(0, match.index);
		const last = inline.children?.[inline.children.length - 1];
		if (last?.type === "text") last.content = last.content.replace(/\s*\{#[\w-]+\}\s*$/, "");
	});
});

const escape = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const require = createRequire(import.meta.url);
const FONTS = [400, 700].map((weight) => ({
	weight,
	file: `fonts/noto-serif-bengali-${weight}.woff`,
	source: require.resolve(`@fontsource/noto-serif-bengali/files/noto-serif-bengali-bengali-${weight}-normal.woff`),
}));

const CSS = `${FONTS.map(
	(f) => `@font-face { font-family: "Noto Serif Bengali"; font-weight: ${f.weight}; src: url("${f.file}") format("woff"); }`,
).join("\n")}
body { font-family: "Noto Serif Bengali", serif; line-height: 1.7; margin: 0 1em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; page-break-after: avoid; }
h1 { text-align: center; margin: 2em 0 1.5em; }
p { margin: 0; text-indent: 1.5em; }
h1 + p, h2 + p, h3 + p, .verse p, figure p { text-indent: 0; }
.verse { margin: 1em 2em; }
.verse p { white-space: pre-line; margin-bottom: 0.8em; }
img { max-width: 100%; }
p:has(> img:only-child) { text-indent: 0; text-align: center; margin: 1em 0; }
table { border-collapse: collapse; margin: 1em auto; }
td, th { border: 1px solid #999; padding: 0.2em 0.5em; }
.footnotes { font-size: 0.9em; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { height: 100%; max-height: 100vh; }`;

function xhtml(title: string, body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="bn" lang="bn">
<head><meta charset="UTF-8"/><title>${escape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;
}

const chapterFile = (index: number) => `ch${String(index + 1).padStart(3, "0")}.xhtml`;

/** Nested <ol> of the entries up to `depth`, each linking to its chapter file and heading anchor. */
function navList(entries: UsedTocEntry[], depth: number): string {
	const items = entries.filter((e) => e.level <= depth);
	let html = "<ol>";
	let level = items[0]?.level ?? 1;
	const open = [level];
	items.forEach((entry, i) => {
		if (i > 0) {
			if (entry.level > level) {
				html += "<ol>";
				open.push(entry.level);
			} else {
				html += "</li>";
				while (open.length > 1 && entry.level < (open[open.length - 1] ?? 1)) {
					html += "</ol></li>";
					open.pop();
				}
			}
		}
		level = entry.level;
		html += `<li><a href="${chapterFile(entry.chapter)}#${entry.anchor}">${escape(entry.title)}</a>`;
	});
	if (items.length > 0) html += "</li>";
	for (let i = 1; i < open.length; i++) html += "</ol></li>";
	return `${html}</ol>`;
}

/** Write an EPUB 3 book: one XHTML file per chapter, a nav document, the cover, figures and an embedded Bangla font. */
export async function writeEpub(book: EpubInput): Promise<Uint8Array> {
	const title = book.title || "Untitled";
	const chapters = book.chapters.length > 0 ? book.chapters : [{ title, markdown: "" }];
	const files: Zippable = {
		mimetype: [strToU8("application/epub+zip"), { level: 0 }],
		"META-INF/container.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
		"OEBPS/style.css": strToU8(CSS),
		"OEBPS/cover.jpg": book.cover,
		"OEBPS/cover.xhtml": strToU8(
			xhtml(title, `<section class="cover" epub:type="cover"><img src="cover.jpg" alt="${escape(title)}"/></section>`),
		),
	};
	for (const font of FONTS) files[`OEBPS/${font.file}`] = await readFile(font.source);
	for (const figure of book.figures) files[`OEBPS/${figure.crop.file}`] = figure.data;
	chapters.forEach((chapter, i) => {
		const body = md.render(chapter.markdown, {});
		files[`OEBPS/${chapterFile(i)}`] = strToU8(
			xhtml(chapter.title || title, `<section epub:type="chapter">\n${body}</section>`),
		);
	});
	const nav = book.toc.length > 0 ? navList(book.toc, book.tocDepth) : `<ol><li><a href="${chapterFile(0)}">${escape(title)}</a></li></ol>`;
	files["OEBPS/nav.xhtml"] = strToU8(
		xhtml(title, `<nav epub:type="toc" id="toc"><h1>সূচিপত্র</h1>\n${nav}\n</nav>`),
	);

	const manifest = [
		`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
		`<item id="css" href="style.css" media-type="text/css"/>`,
		`<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`,
		`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
		...FONTS.map((f, i) => `<item id="font${i}" href="${f.file}" media-type="font/woff"/>`),
		...book.figures.map((f, i) => `<item id="fig${i}" href="${f.crop.file}" media-type="image/jpeg"/>`),
		...chapters.map((_, i) => `<item id="ch${i + 1}" href="${chapterFile(i)}" media-type="application/xhtml+xml"/>`),
	];
	const spine = [`<itemref idref="cover" linear="yes"/>`, ...chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`)];
	const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
	const optional = [
		book.author && `<dc:creator id="author">${escape(book.author)}</dc:creator>`,
		book.publisher && `<dc:publisher>${escape(book.publisher)}</dc:publisher>`,
		/^\d{4}$/.test(book.year) && `<dc:date>${book.year}</dc:date>`,
	].filter(Boolean);
	files["OEBPS/content.opf"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="bn">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:uuid:${book.id}</dc:identifier>
<dc:title>${escape(title)}</dc:title>
<dc:language>bn</dc:language>
${optional.join("\n")}
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine>
${spine.join("\n")}
</spine>
</package>`);
	return zipSync(files, { level: 9 });
}
