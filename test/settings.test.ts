import { expect, it } from "vitest";
import { defaultSettings, GEMINI_BASE_URL, parseSettings } from "../src/settings.ts";

it("loads a saved native Gemini provider as OpenAI-compatible on Gemini's endpoint, keeping key, model, limits and stages", () => {
	const old = {
		...defaultSettings(),
		providers: [
			{ id: "gemini", name: "Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "k", model: "gemini-flash-lite-latest", rpm: 10, rpd: 250, concurrency: 2, priceIn: 0, priceOut: null },
			{ id: "o", name: "O", kind: "openai", baseUrl: "http://x/v1", apiKey: "", model: "m", rpm: 0, rpd: 0, concurrency: 1 },
		],
		stages: { ocr: ["o", "gemini"], proofread: ["gemini"], assemble: [] },
	};
	const parsed = parseSettings(old, defaultSettings());
	if ("error" in parsed) throw new Error(parsed.error);
	expect(parsed.providers[0]).toEqual({ ...old.providers[0], kind: "openai", baseUrl: GEMINI_BASE_URL });
	expect(parsed.stages).toEqual(old.stages);
});
