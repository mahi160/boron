import { createModels, createProvider, type Model, type Models } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { paths } from "./config.ts";
import { piCredentialStore } from "./pi-auth.ts";
import type { ProviderConfig, Settings } from "./settings.ts";

/** Claude models of pi-ai's Anthropic catalog that read images and can run with thinking off; a "pi" provider must use one. */
export function piModelIds(): string[] {
	return anthropicProvider()
		.getModels()
		.flatMap((m) => (m.input.includes("image") && m.thinkingLevelMap?.off !== null ? [m.id] : []));
}

type Listed = readonly { id: string; cost: { input: number; output: number; cacheRead: number; cacheWrite: number } }[];
let catalogs: { gemini: Listed; pi: Listed } | undefined;

/**
 * Price in USD per million tokens of a request to `p`: its own price, else pi-ai's catalog price, else 0. Cached input
 * (read or written) has its own catalog price; a price set in Settings applies to all input.
 */
export function prices(p: ProviderConfig): { input: number; output: number; cacheRead: number; cacheWrite: number } {
	catalogs ??= { gemini: googleProvider().getModels(), pi: anthropicProvider().getModels() };
	// ponytail: base tier only (Haiku charges more above 100k input tokens); add tiers when a request gets that big.
	// An OpenAI-compatible provider running a known Gemini model (Gemini's endpoint) gets its catalog price.
	const listed = catalogs[p.kind === "openai" ? "gemini" : p.kind].find((m) => m.id === p.model)?.cost;
	const input = p.priceIn ?? listed?.input ?? 0;
	const cached = p.priceIn === null ? listed : undefined;
	return { input, output: p.priceOut ?? listed?.output ?? 0, cacheRead: cached?.cacheRead ?? input, cacheWrite: cached?.cacheWrite ?? input };
}

/**
 * Claude through pi's login: pi-ai's Anthropic provider (its OAuth refresh, headers and catalog entry) under the
 * Boron provider's id. Thinking stays off: pi-durable sends no reasoning level, and pi-ai then disables thinking.
 */
function piProvider(p: ProviderConfig) {
	const anthropic = anthropicProvider();
	const model = anthropic.getModels().find((m) => m.id === p.model);
	return createProvider({
		id: p.id,
		name: p.name,
		baseUrl: anthropic.baseUrl,
		auth: { oauth: anthropic.auth.oauth },
		models: model === undefined ? [] : [{ ...model, provider: p.id }],
		api: anthropicMessagesApi(),
	});
}

/** A vision chat model for a configured provider; limits are generous because Boron sends few, large requests. */
function model(p: ProviderConfig): Model<"openai-completions"> {
	return {
		id: p.model,
		name: p.model,
		provider: p.id,
		baseUrl: p.baseUrl,
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		api: "openai-completions",
	};
}

function provider(p: ProviderConfig) {
	if (p.kind === "pi") return piProvider(p);
	return createProvider({
		id: p.id,
		name: p.name,
		baseUrl: p.baseUrl,
		// Keyless local servers (Ollama) still need a key-shaped value for the OpenAI client.
		auth: { apiKey: { name: p.name, resolve: async () => ({ auth: { apiKey: p.apiKey || "none" } }) } },
		models: [model(p)],
		api: openAICompletionsApi(),
	});
}

/** Models holding just `p`, for the settings screen's test button. */
export function providerModels(p: ProviderConfig): Models {
	const models = createModels({ credentials: piCredentialStore(paths.piAuth, (id) => id === p.id && p.kind === "pi") });
	models.setProvider(provider(p));
	return models;
}

let cache: { settings: Settings; models: Models } | undefined;

/** Models for the current settings, rebuilt when the settings object changes. */
export function modelsFor(settings: Settings): Models {
	if (cache?.settings !== settings) {
		const isPi = (id: string) => settings.providers.some((p) => p.id === id && p.kind === "pi");
		const models = createModels({ credentials: piCredentialStore(paths.piAuth, isPi) });
		for (const p of settings.providers) models.setProvider(provider(p));
		cache = { settings, models };
	}
	return cache.models;
}
