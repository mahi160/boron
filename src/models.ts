import { createModels, createProvider, type Model, type Models } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ProviderConfig, Settings } from "./settings.ts";

/** A vision chat model for a configured provider; limits are generous because Boron sends few, large requests. */
function model(p: ProviderConfig): Model<"google-generative-ai"> | Model<"openai-completions"> {
	const input: Model<"openai-completions">["input"] = ["text", "image"];
	const base = {
		id: p.model,
		name: p.model,
		provider: p.id,
		baseUrl: p.baseUrl,
		reasoning: false,
		input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
	};
	return p.kind === "gemini" ? { ...base, api: "google-generative-ai" } : { ...base, api: "openai-completions" };
}

function provider(p: ProviderConfig) {
	return createProvider({
		id: p.id,
		name: p.name,
		baseUrl: p.baseUrl,
		// Keyless local servers (Ollama) still need a key-shaped value for the OpenAI client.
		auth: { apiKey: { name: p.name, resolve: async () => ({ auth: { apiKey: p.apiKey || "none" } }) } },
		models: [model(p)],
		api: p.kind === "gemini" ? googleGenerativeAIApi() : openAICompletionsApi(),
	});
}

/** Models holding just `p`, for the settings screen's test button. */
export function providerModels(p: ProviderConfig): Models {
	const models = createModels();
	models.setProvider(provider(p));
	return models;
}

let cache: { settings: Settings; models: Models } | undefined;

/** Models for the current settings, rebuilt when the settings object changes. */
export function modelsFor(settings: Settings): Models {
	if (cache?.settings !== settings) {
		const models = createModels();
		for (const p of settings.providers) models.setProvider(provider(p));
		cache = { settings, models };
	}
	return cache.models;
}
