import { createModels, createProvider, type Model, type Models } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { loginCredentialStore } from "./login-files.ts";
import { LOGINS } from "./logins.ts";
import type { ProviderConfig, Settings } from "./settings.ts";

type Listed = readonly { id: string; cost: { input: number; output: number; cacheRead: number; cacheWrite: number } }[];
let gemini: Listed | undefined;

/**
 * Price in USD per million tokens of a request to `p`: its own price, else pi-ai's catalog price, else 0. Cached input
 * (read or written) has its own catalog price; a price set in Settings applies to all input.
 */
export function prices(p: ProviderConfig): { input: number; output: number; cacheRead: number; cacheWrite: number } {
	// An OpenAI-compatible provider running a known Gemini model (Gemini's endpoint) gets its catalog price.
	const catalog = p.login === null ? (gemini ??= googleProvider().getModels()) : LOGINS[p.login].provider().getModels();
	// ponytail: base tier only (Haiku charges more above 100k input tokens); add tiers when a request gets that big.
	const listed = catalog.find((m) => m.id === p.model)?.cost;
	const input = p.priceIn ?? listed?.input ?? 0;
	const cached = p.priceIn === null ? listed : undefined;
	return { input, output: p.priceOut ?? listed?.output ?? 0, cacheRead: cached?.cacheRead ?? input, cacheWrite: cached?.cacheWrite ?? input };
}

/**
 * A borrowed login: pi-ai's provider for it (auth, headers and catalog entry) under the Boron provider's id. Thinking
 * stays off: pi-durable sends no reasoning level, and pi-ai then disables thinking.
 */
function loginProvider(p: ProviderConfig & { login: keyof typeof LOGINS }) {
	const login = LOGINS[p.login];
	const family = login.provider();
	const model = family.getModels().find((m) => m.id === p.model);
	return createProvider({
		id: p.id,
		name: p.name,
		baseUrl: family.baseUrl,
		auth: login.auth === "oauth" ? { oauth: family.auth.oauth } : { apiKey: family.auth.apiKey },
		models: model === undefined ? [] : [{ ...model, provider: p.id }],
		api: login.api(),
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
	if (p.login !== null) return loginProvider({ ...p, login: p.login });
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
	const models = createModels({ credentials: credentials([p]) });
	models.setProvider(provider(p));
	return models;
}

/** Each login provider's credential lives in its tool's login file; key providers store none. */
function credentials(providers: readonly ProviderConfig[]) {
	return loginCredentialStore((id) => {
		const login = providers.find((p) => p.id === id)?.login;
		return login == null ? undefined : LOGINS[login].source();
	});
}

let cache: { settings: Settings; models: Models } | undefined;

/** Models for the current settings, rebuilt when the settings object changes. */
export function modelsFor(settings: Settings): Models {
	if (cache?.settings !== settings) {
		const models = createModels({ credentials: credentials(settings.providers) });
		for (const p of settings.providers) models.setProvider(provider(p));
		cache = { settings, models };
	}
	return cache.models;
}
