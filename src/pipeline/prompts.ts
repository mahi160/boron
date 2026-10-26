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
		"Change a word only where the OCR text differs from what the image shows. If the printed word itself is misspelled or uses an old or uncommon spelling (for example ন for ণ, or a missing vowel sign), keep it exactly as printed: you are matching the page, not correcting the author.",
		"Report only the corrections, never the whole page again, and never an edit whose replace equals its find.",
	].join("\n"),
	metadata: [
		"These are the first pages of a scanned Bangla book.",
		"Find the title page and read the book's metadata exactly as printed.",
	].join("\n"),
	translate: [
		"You translate an English book into Bangla, one chunk at a time.",
		"Write modern standard Bangla (cholito bhasha) that reads naturally, faithful to the meaning, tone and register of the English. Translate everything: never summarize, skip or add anything.",
		"Use the glossary's Bangla form for every name and term it lists. Write other names consistently in Bangla script.",
		"The previous chunk's translation is given for context only, so the chunk continues it smoothly; do not translate or repeat it.",
	].join("\n"),
	polish: [
		"You revise a draft Bangla translation of a chunk of an English book against the English.",
		"Fix mistranslations, and translate anything the draft left out or remove anything it added. Then make it read fluently as modern standard Bangla (cholito bhasha), without changing the meaning.",
		"Use the glossary's Bangla form for every name and term it lists. Keep the draft's wording wherever it is already right.",
	].join("\n"),
	glossary: [
		"You prepare a glossary for translating an English book into Bangla.",
		"List the names of people, places and organisations, and the recurring special terms, whose Bangla form must stay the same throughout the book, each with the Bangla form to use in modern standard Bangla spelling.",
		"Leave out ordinary words that need no fixed translation.",
	].join("\n"),
};

const MARKDOWN_RULES = `Keep the Markdown exactly as structured in the English: the same headings with the same number of #, the same paragraphs and blank lines, **bold**, *italic*, lists, > block quotes, and line breaks written as a backslash at the end of a line. Keep every image line ![alt](path) with its path unchanged; translate only its alt text.`;

export const TRANSLATE_CONTRACT = `${MARKDOWN_RULES}
Answer with the Bangla Markdown of the chunk only: no preamble, no notes, no code fence.`;

export const POLISH_CONTRACT = `${MARKDOWN_RULES}
Answer with the whole revised Bangla Markdown of the chunk only: no preamble, no list of changes, no code fence.`;

export const GLOSSARY_CONTRACT = `Answer with JSON only: [{"en": "<name or term as written in the book>", "bn": "<its Bangla form>"}]`;

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

export const PROOFREAD_CONTRACT = `Answer with JSON only: an array with one object for every page you were given, in this shape:
[{"page": <page number given before its image>,
  "edits": [{"find": "<text copied exactly from the OCR text>", "replace": "<the corrected text>"}]}]
Use an empty edits list when the OCR text has no errors. Copy "find" character for character from the OCR text between <<< and >>>, including spaces and punctuation, and make it long enough (a few words around the error) to occur only once on the page. Keep each edit small, and never let two edits cover the same text: every "find" quotes the OCR text as given, not as changed by another edit.`;

export const NO_FIGURES = "Do not report figures: leave figures empty and put no figure placeholders in the markdown.";

export const METADATA_CONTRACT = `Answer with JSON only: {"title": "...", "author": "...", "publisher": "...", "year": "..."}. Use empty strings for anything not printed.`;
