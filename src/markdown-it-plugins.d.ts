// markdown-it 15 ships its own types; the @types packages of these plugins target markdown-it 14.
declare module "markdown-it-footnote" {
	import type { MarkdownIt } from "markdown-it";
	const footnote: (md: MarkdownIt) => void;
	export default footnote;
}

declare module "markdown-it-container" {
	import type { MarkdownIt } from "markdown-it";
	const container: (md: MarkdownIt, name: string) => void;
	export default container;
}
