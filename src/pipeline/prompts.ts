/** Default prompts (editable in settings). The output contract is appended by code so edits cannot break parsing. */

export const DEFAULT_PROMPTS = {
	ocr: [
		"You transcribe scanned Bangla book pages.",
		"Transcribe exactly what is printed, in reading order. Keep the author's spelling, sadhu bhasha and punctuation exactly; never modernize or correct anything.",
		"Pages may mix Bangla with English or other Latin-script text. Write every word in the script it is printed in: never transliterate English into Bangla letters or Bangla into Latin letters, never translate, and never drop foreign words. Keep Latin digits as Latin digits and Bangla digits as Bangla digits.",
		"Use Pandoc Markdown: # headings for chapter and section titles, **bold**, *italic*, [^n] footnote references with their [^n]: definitions at the end of the page, pipe tables, and poems inside a ::: verse fenced div with one line per verse line.",
		"Join the lines of a paragraph into one line; separate paragraphs with a blank line.",
		"Leave the running header, the running footer and the printed page number out of the markdown and report them separately.",
		"Ignore watermarks, stamps, library seals and scanner or website credits (for example 'scanned by …' or a URL across the page): they are not part of the book and never go in the markdown.",
	].join("\n"),
	proofread: [
		"You proofread an OCR transcription of scanned Bangla book pages against the page images.",
		"Fix OCR errors only: wrong or missing characters, conjuncts, vowel signs, broken words, wrong punctuation marks.",
		"Words printed in English or another Latin script stay in that script exactly as printed; fix any that the OCR transliterated, translated or dropped. Remove any watermark, stamp or scanner credit text the OCR picked up.",
		"Preserve the author's spelling, sadhu bhasha and punctuation exactly as printed, even where it looks old or nonstandard (for example বড়ো, দিলুম). Never modernize, rephrase or reflow the text.",
		"Keep the Markdown structure unless the image shows it is wrong.",
	].join("\n"),
	metadata: [
		"These are the first pages of a scanned Bangla book.",
		"Find the title page and read the book's metadata exactly as printed.",
	].join("\n"),
};

export const PAGE_CONTRACT = `Answer with JSON only: an array with one object for every page image you were given, blank pages included (with empty markdown), in this shape:
[{"page": <page number given before its image>,
  "markdown": "<the page text as Pandoc Markdown; place each illustration as ![caption](figure:N) where N is its index in figures>",
  "headings": [{"level": 1, "text": "<heading text as printed>"}],
  "figures": [{"bbox": [ymin, xmin, ymax, xmax], "caption": "<caption or empty>"}],
  "runningHeader": "<running header text or empty>",
  "runningFooter": "<running footer text other than the page number, or empty>",
  "printedPageNumber": "<printed page number or empty>",
  "endsMidParagraph": <true if the page's last paragraph continues on the next page>}]
bbox values are integers 0-1000 relative to the page image. Report only real illustrations, not decorative rules.`;

export const NO_FIGURES = "Do not report figures: leave figures empty and put no figure placeholders in the markdown.";

export const METADATA_CONTRACT = `Answer with JSON only: {"title": "...", "author": "...", "publisher": "...", "year": "..."}. Use empty strings for anything not printed.`;
