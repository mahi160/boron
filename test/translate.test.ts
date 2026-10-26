import { fauxAssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { exportTranslation } from "../src/epub/export.ts";
import { chunkMarkdown, readEpub, xhtmlToMarkdown } from "../src/epub/source.ts";
import { openStore } from "../src/store.ts";
import { makeEpub } from "./helpers/epub.ts";
import { fauxModels, provider, startBoron, type TestBoron, testSettings, until } from "./helpers/boron.ts";

describe("reading an EPUB", () => {
	it("turns the spine into Markdown with chapter headings, emphasis, breaks and images, and reads the metadata", () => {
		const epub = readEpub(makeEpub());
		expect(epub).toMatchObject({ title: "The Small Book", author: "Ann Author", cover: { mediaType: "image/png" } });
		expect(epub.images.map((i) => i.file)).toEqual(["1-map_1.png"]);
		expect(epub.markdown).toBe(
			[
				"# Chapter One",
				"It was a **bright** cold *day* in April.",
				"The clocks were\\\nstriking thirteen & more.",
				"## A part",
				"Third paragraph here.",
				"# Chapter Two",
				"![A map](images/1-map_1.png)",
				"The map",
				"Last words.",
			].join("\n\n"),
		);
	});

	it("keeps spaces outside emphasis and escapes Markdown in text", () => {
		expect(xhtmlToMarkdown("<p>a<em> b </em>c *d*</p>", () => null)).toEqual(["a *b* c \\*d\\*"]);
	});

	it("keeps numbered paragraphs, headings with breaks and table rows readable", () => {
		expect(xhtmlToMarkdown("<p>1914. The war</p><h1>Title<br/>Sub</h1><table><tr><td>a</td><td>b</td></tr></table>", () => null)).toEqual([
			"1914\\. The war",
			"# Title Sub",
			"a | b",
		]);
	});

	it("splits into chunks of about the given size without splitting a paragraph", () => {
		const para = (n: number) => Array.from({ length: n }, () => "word").join(" ");
		const chunks = chunkMarkdown([para(4), para(4), para(10), para(2)].join("\n\n"), 8);
		expect(chunks).toEqual([[para(4), para(4)].join("\n\n"), para(10), para(2)]);
	});
});

const between = (text: string, label: string) => new RegExp(`${label}, between the markers:\\n<<<\\n([\\s\\S]*?)\\n>>>`).exec(text)?.[1] ?? "";

function userText(context: TranscriptContext): string {
	const user = context.messages.filter((m) => m.role === "user").at(-1);
	const content = user?.content;
	return typeof content === "string" ? content : (content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
}

const step = (context: TranscriptContext) => {
	const system = JSON.stringify(context.messages.filter((m) => m.role === "system"));
	return system.includes("prepare a glossary") ? "glossary" : system.includes("You revise") ? "polish" : "translate";
};

const toBangla = (english: string) => english.replace(/Chapter/g, "অধ্যায়").replace(/words/g, "কথা");

const running: TestBoron[] = [];
afterEach(async () => {
	for (const t of running.splice(0)) await t.close();
});

describe("translation job", () => {
	it("translates chunks in order with the previous chunk as context, polishes, and exports a Bangla EPUB", async () => {
		const seen: { step: string; text: string }[] = [];
		const { models } = fauxModels(["a"], (context) => {
			const text = userText(context);
			const s = step(context);
			seen.push({ step: s, text });
			if (s === "glossary") return fauxAssistantMessage(JSON.stringify([{ en: "April", bn: "এপ্রিল" }]));
			if (s === "polish") return fauxAssistantMessage(between(text, "The draft Bangla translation to revise").replace("অধ্যায়", "পরিচ্ছেদ"));
			return fauxAssistantMessage(toBangla(between(text, "The English chunk to translate")));
		});
		const t = await startBoron({ settings: testSettings({ providers: [provider("a")], chunkWords: 12 }), models });
		running.push(t);
		const id = await t.boron.addEpub("small.epub", makeEpub(), readEpub(makeEpub()));
		await until(t, () => t.store.book(id)?.status === "ready");

		const book = t.store.book(id);
		expect(book).toMatchObject({ kind: "epub-translate", title: "The Small Book", author: "Ann Author", cover: { kind: "upload" } });
		expect(book?.glossary).toEqual([{ en: "April", bn: "এপ্রিল" }]);
		const pages = t.store.pages(id);
		expect(pages.length).toBeGreaterThan(1);
		expect(pages.every((p) => p.status === "done")).toBe(true);
		// Sequential: glossary, then translate and polish per chunk, each translate after the previous chunk finished.
		expect(seen.map((s) => s.step)).toEqual(["glossary", ...pages.flatMap(() => ["translate", "polish"])]);
		const translations = seen.filter((s) => s.step === "translate");
		expect(translations[0]?.text).not.toContain("previous chunk");
		expect(translations[1]?.text).toContain(`The previous chunk's Bangla translation, for context only, between the markers:\n<<<\n${pages[0]?.proofread?.markdown}\n>>>`);
		expect(translations.every((s) => s.text.includes("- April \u2192 এপ্রিল"))).toBe(true);
		expect(pages[0]?.raw?.markdown).toContain("# অধ্যায় One");
		expect(pages[0]?.proofread?.markdown).toContain("# পরিচ্ছেদ One");

		if (book === undefined) throw new Error("book is gone");
		const epub = unzipSync(
			await exportTranslation({ book, pages, tocDepth: 2, image: (file) => t.boron.files.image(id, file), uploadedCover: t.boron.files.cover(id) }),
		);
		const opf = strFromU8(epub["OEBPS/content.opf"] ?? new Uint8Array());
		expect(opf).toContain("<dc:language>bn</dc:language>");
		expect(opf).toContain('href="images/1-map_1.png" media-type="image/png"');
		expect(epub["OEBPS/images/1-map_1.png"]).toBeDefined();
		expect(epub["OEBPS/cover.jpg"]).toBeDefined();
		const text = Object.entries(epub)
			.filter(([name]) => /ch\d+\.xhtml$/.test(name))
			.map(([, data]) => strFromU8(data))
			.join("\n");
		expect(text).toMatch(/<h1 id="[^"]+">পরিচ্ছেদ One<\/h1>/);
		expect(text).toMatch(/<h2 id="[^"]+">A part<\/h2>/);
		expect(text).toContain("<strong>bright</strong>");
		expect(text).toContain("<em>day</em>");
		expect(text).toContain("were<br />");
		expect(text).toContain('<img src="images/1-map_1.png" alt="A map" />');
	});

	it("skips polishing when it is off, and retries a translation that lost an image", async () => {
		let lost = true;
		const { models, requests } = fauxModels(["a"], (context) => {
			const english = between(userText(context), "The English chunk to translate");
			if (english.includes("![") && lost) {
				lost = false;
				return fauxAssistantMessage("অনুবাদ, ছবি ছাড়া");
			}
			return fauxAssistantMessage(toBangla(english));
		});
		const settings = testSettings({ providers: [provider("a")], polish: false, chunkWords: 100_000 });
		const t = await startBoron({ settings: { ...settings, stages: { ...settings.stages, proofread: ["a"] } }, models });
		running.push(t);
		const id = await t.boron.addEpub("small.epub", makeEpub(), readEpub(makeEpub()));
		t.store.updateBook(id, { glossary: [] });
		await until(t, () => t.store.book(id)?.status === "ready");
		expect(requests).toHaveLength(2);
		expect(t.store.page(id, 1)).toMatchObject({ status: "done", proofread: null });
		expect(t.store.page(id, 1)?.raw?.markdown).toContain("![A map](images/1-map_1.png)");
	});
});

describe("glossary edits", () => {
	it("translates a chunk again with the edited glossary", async () => {
		const texts: string[] = [];
		const { models } = fauxModels(["a"], (context) => {
			texts.push(userText(context));
			return fauxAssistantMessage(toBangla(between(userText(context), "The English chunk to translate")));
		});
		const t = await startBoron({ settings: testSettings({ providers: [provider("a")], polish: false }), models });
		running.push(t);
		const id = await t.boron.addEpub("small.epub", makeEpub(), readEpub(makeEpub()));
		t.store.updateBook(id, { glossary: [] });
		await until(t, () => t.store.book(id)?.status === "ready");
		t.store.updateBook(id, { glossary: [{ en: "Chapter", bn: "\u09aa\u09b0\u09bf\u099a\u09cd\u099b\u09c7\u09a6" }] });
		expect(await t.boron.rerun(id, [1])).toBe(true);
		await until(t, () => texts.length === 2 && t.store.page(id, 1)?.status === "done");
		expect(texts[0]).toContain("Glossary: none.");
		expect(texts[1]).toContain("- Chapter \u2192 \u09aa\u09b0\u09bf\u099a\u09cd\u099b\u09c7\u09a6");
	});
});

describe("store migration", () => {
	it("marks books from before translation as OCR books and allows the translation batch jobs", async () => {
		const { DatabaseSync } = await import("node:sqlite");
		const { tempDir } = await import("./helpers/books.ts");
		const path = `${await tempDir()}/old.db`;
		const old = new DatabaseSync(path);
		old.exec(`CREATE TABLE books (id TEXT PRIMARY KEY, file_name TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, cover TEXT NOT NULL, created_at INTEGER NOT NULL);
			INSERT INTO books VALUES ('b', 'x.pdf', 'X', 'ready', '{"kind":"page","page":1}', 1);
			CREATE TABLE batches (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL, pages TEXT NOT NULL, job TEXT NOT NULL CHECK (job IN ('pages', 'metadata')), owner INTEGER, task_id INTEGER, state TEXT NOT NULL, stage TEXT, provider TEXT, wake_at INTEGER, note TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
			INSERT INTO batches (book_id, pages, job, state, updated_at) VALUES ('b', '[1]', 'pages', 'done', 1);`);
		old.close();
		const store = openStore(path);
		expect(store.book("b")?.kind).toBe("pdf-ocr");
		expect(store.batches("b")).toHaveLength(1);
		store.createBatch("b", [1], "translate", null);
		expect(store.batches("b").map((b) => b.job)).toEqual(["pages", "translate"]);
		store.close();
	});
});
