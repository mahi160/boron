import MarkdownIt from "markdown-it";
import container from "markdown-it-container";
import footnote from "markdown-it-footnote";

// The same Markdown the EPUB is written from (src/epub/epub.ts); raw HTML stays off, so model text cannot inject any.
const md = new MarkdownIt({ html: false, linkify: false, typographer: false }).use(footnote).use(container, "verse");

/** HTML of one page's Markdown, with figure placeholders pointing at `figureUrl`. */
export function renderPage(markdown: string, figureUrl: (index: number) => string): string {
	return md.render(markdown.replace(/!\[([^\]]*)\]\(figure:(\d+)\)/g, (_, caption: string, n: string) => `![${caption}](${figureUrl(Number(n))})`));
}
