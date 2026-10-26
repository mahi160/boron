import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createApi } from "../src/api.ts";
import type { Settings } from "../src/settings.ts";
import type { PageRow } from "../src/store.ts";
import { addBook, answer, fauxModels, provider, startBoron, type TestBoron, testSettings, until } from "./helpers/boron.ts";
import { tempDir } from "./helpers/books.ts";
import { makePdf } from "./helpers/pdf.ts";

let t: TestBoron;
let api: ReturnType<typeof createApi>;

beforeEach(async () => {
	vi.stubEnv("BORON_DATA_DIR", await tempDir());
	vi.resetModules();
	const settings = testSettings({ providers: [provider("a", { apiKey: "secret-key-1234" })], proofread: false });
	t = await startBoron({ settings, models: fauxModels(["a"], (context) => answer(context)).models });
	// The API reads settings from the settings module; save the test's settings there.
	const { saveSettings } = await import("../src/settings.ts");
	await saveSettings(settings);
	const { createApi: create } = await import("../src/api.ts");
	api = create(t.boron, t.store);
});
afterEach(async () => {
	await t.close();
	vi.unstubAllEnvs();
});

const json = (method: string, body: unknown) => ({
	method,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

// The response shapes the routes promise; the assertions below check them.
const read = async <T>(response: Response | Promise<Response>): Promise<T> => (await (await response).json()) as T;

describe("settings", () => {
	it("never returns API keys in full, and keeps the stored key when the masked one comes back", async () => {
		const shown = await read<Settings>(api.request("/settings"));
		expect(shown.providers[0]?.apiKey).toBe("••••1234");
		const saved = await api.request("/settings", json("PUT", shown));
		expect(await saved.json()).toMatchObject({ providers: [{ apiKey: "••••1234" }] });
		const { getSettings } = await import("../src/settings.ts");
		expect(getSettings().providers[0]?.apiKey).toBe("secret-key-1234");
	});

	it("refuses changes from another site, so a page elsewhere cannot use the stored key", async () => {
		const response = await api.request("http://localhost:3000/providers/test", {
			method: "POST",
			headers: { "content-type": "text/plain", origin: "https://evil.example", host: "localhost:3000" },
			body: JSON.stringify({ provider: { id: "a", baseUrl: "https://evil.example", apiKey: "\u2022\u2022\u2022\u20221234" } }),
		});
		expect(response.status).toBe(403);
	});

	it("asks for the key again when a provider's base URL changes", async () => {
		const shown = await read<Settings>(api.request("/settings"));
		const moved = { ...shown, providers: shown.providers.map((p) => ({ ...p, baseUrl: "https://elsewhere.example/v1" })) };
		const response = await api.request("/settings", json("PUT", moved));
		expect(response.status).toBe(400);
		expect((await read<{ error: string }>(response)).error).toContain("enter the API key again");
	});

	it("rejects invalid settings with a message", async () => {
		const shown = await read<Settings>(api.request("/settings"));
		const response = await api.request("/settings", json("PUT", { ...shown, pagesPerRequest: 0 }));
		expect(response.status).toBe(400);
		expect((await read<{ error: string }>(response)).error).toContain("pages per request");
	});
});

describe("books", () => {
	it("rejects an upload that is not a PDF", async () => {
		const form = new FormData();
		form.append("file", new File(["hello"], "notes.txt"));
		const response = await api.request("/books", { method: "POST", body: form });
		expect(response.status).toBe(400);
	});

	it("uploads, reads, edits a page and exports an EPUB that uses the edit", async () => {
		const form = new FormData();
		form.append("file", new File([makePdf(2)], "gora.pdf", { type: "application/pdf" }));
		const created = await api.request("/books", { method: "POST", body: form });
		expect(created.status).toBe(201);
		const { id } = await read<{ id: string }>(created);
		await until(t, () => t.store.book(id)?.status === "ready");

		const detail = await read<{ pages: PageRow[] }>(api.request(`/books/${id}`));
		expect(detail.pages.map((p) => p.status)).toEqual(["done", "done"]);
		expect((await api.request(`/books/${id}/pages/1/image`)).headers.get("content-type")).toBe("image/jpeg");

		const edit = await api.request(`/books/${id}/pages/2`, json("PUT", { markdown: "সম্পাদিত পাতা" }));
		expect((await read<PageRow>(edit)).edited).toBe("সম্পাদিত পাতা");

		const epub = await api.request(`/books/${id}/epub`);
		const files = unzipSync(new Uint8Array(await epub.arrayBuffer()));
		expect(new TextDecoder().decode(files["OEBPS/ch001.xhtml"])).toContain("সম্পাদিত পাতা");
	});

	it("rejects page numbers past the end and unknown books", async () => {
		const id = await addBook(t, 1);
		expect((await api.request(`/books/${id}/pages/9`)).status).toBe(404);
		expect((await api.request("/books/nope")).status).toBe(404);
		expect((await api.request(`/books/${id}/toc`, json("PUT", { toc: [{ id: "x", page: 1, title: "", level: 1 }] }))).status).toBe(400);
	});
});
