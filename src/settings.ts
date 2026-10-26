import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./config.ts";
import { isObj, type Obj } from "./json.ts";
import { piModelIds } from "./models.ts";
import { DEFAULT_PROMPTS } from "./pipeline/prompts.ts";

export const STAGES = ["ocr", "proofread", "assemble"] as const;
export type Stage = (typeof STAGES)[number];

export type ProviderConfig = {
	id: string;
	name: string;
	/** `gemini`: Google's native API. `openai`: any OpenAI-compatible endpoint (Gemini's, Ollama, vLLM, OpenRouter). */
	kind: "gemini" | "openai" | "pi";
	baseUrl: string;
	apiKey: string;
	model: string;
	/** Requests per minute / per day / at once; 0 = unlimited. */
	rpm: number;
	rpd: number;
	concurrency: number;
	/** USD per million input / output tokens, for the cost view; null = pi-ai's catalog price for the model, if it has one. */
	priceIn: number | null;
	priceOut: number | null;
};

export type Prompts = { ocr: string; proofread: string; metadata: string };

export type Settings = {
	providers: ProviderConfig[];
	/** Ordered provider ids per stage; the first available one is used. */
	stages: Record<Stage, string[]>;
	pagesPerRequest: number;
	imageMaxSide: number;
	jpegQuality: number;
	quotaReset: { time: string; timeZone: string };
	proofread: boolean;
	tesseractFallback: boolean;
	figures: boolean;
	/** Whiten faint watermarks and paper tone in the images OCR reads. */
	cleanScans: boolean;
	prompts: Prompts;
	tocDepth: number;
};

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const PI_BASE_URL = "https://api.anthropic.com";
export const PI_DEFAULT_MODEL = "claude-haiku-5-5";

export function defaultSettings(): Settings {
	const key = process.env.GEMINI_API_KEY;
	const providers: ProviderConfig[] = key
		? [
				{
					id: "gemini",
					name: "Gemini",
					kind: "gemini",
					baseUrl: GEMINI_BASE_URL,
					apiKey: key,
					// Alias for the newest Flash-Lite: the cheapest current Gemini with a free tier.
					model: "gemini-flash-lite-latest",
					rpm: 10,
					rpd: 250,
					concurrency: 2,
					priceIn: null,
					priceOut: null,
				},
			]
		: [];
	const ids = providers.map((p) => p.id);
	return {
		providers,
		stages: { ocr: ids, proofread: ids, assemble: ids },
		pagesPerRequest: 3,
		imageMaxSide: 2000,
		jpegQuality: 85,
		quotaReset: { time: "00:00", timeZone: "America/Los_Angeles" },
		proofread: true,
		tesseractFallback: true,
		figures: true,
		cleanScans: false,
		prompts: { ...DEFAULT_PROMPTS },
		tocDepth: 2,
	};
}

let current: Settings | undefined;

/** Live settings, read at every use. */
export function getSettings(): Settings {
	if (current === undefined) {
		try {
			const parsed = parseSettings(JSON.parse(readFileSync(paths.settings, "utf8")), defaultSettings());
			if ("error" in parsed) throw new Error(`${paths.settings}: ${parsed.error}`);
			current = parsed;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			current = defaultSettings();
		}
	}
	return current;
}

export async function saveSettings(next: Settings): Promise<void> {
	await mkdir(dirname(paths.settings), { recursive: true });
	await writeFile(`${paths.settings}.tmp`, JSON.stringify(next, null, "\t"));
	await rename(`${paths.settings}.tmp`, paths.settings);
	current = next;
}

const MASK = "••••";

export function maskKey(key: string): string {
	return key === "" ? "" : `${MASK}${key.slice(-4)}`;
}

/** Settings as sent to the browser: API keys reduced to their last four characters. */
export function publicSettings(settings: Settings): Settings {
	return { ...settings, providers: settings.providers.map((p) => ({ ...p, apiKey: maskKey(p.apiKey) })) };
}

class Invalid extends Error {}

function field(o: Obj, key: string): Obj {
	const value = o[key];
	if (!isObj(value)) throw new Invalid(`${key} must be an object`);
	return value;
}

function text(o: Obj, key: string): string {
	const value = o[key];
	return typeof value === "string" ? value.trim() : "";
}

function int(o: Obj, key: string, min: number, max: number, label = key): number {
	const value = o[key];
	if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) return value;
	throw new Invalid(`${label} must be a whole number from ${min} to ${max}`);
}

/** A price in USD per million tokens; missing or null means the catalog price. */
function price(o: Obj, key: string, label: string): number | null {
	const value = o[key];
	if (value === undefined || value === null) return null;
	if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000) return value;
	throw new Invalid(`${label} must be a number from 0 to 1000 (USD per million tokens)`);
}

function parseProvider(raw: unknown, stored: Settings): ProviderConfig {
	if (!isObj(raw)) throw new Invalid("each provider must be an object");
	const id = text(raw, "id");
	if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Invalid(`provider id "${id}" must be 1–40 of a–z, 0–9 and -`);
	const kind = raw.kind;
	if (kind !== "gemini" && kind !== "openai" && kind !== "pi") throw new Invalid(`provider ${id}: kind must be gemini, openai or pi`);
	const model = text(raw, "model");
	if (model === "") throw new Invalid(`provider ${id}: model is required`);
	if (kind === "pi" && !piModelIds().includes(model)) {
		throw new Invalid(`provider ${id}: ${model} is not a Claude vision model that can run with thinking off (try ${PI_DEFAULT_MODEL})`);
	}
	// pi's login carries its own endpoint and credential.
	const endpoint: Obj = kind === "pi" ? { baseUrl: PI_BASE_URL, apiKey: "" } : raw;
	const baseUrl = text(endpoint, "baseUrl") || (kind === "gemini" ? GEMINI_BASE_URL : "");
	if (!/^https?:\/\/\S+$/.test(baseUrl)) throw new Invalid(`provider ${id}: base URL must start with http:// or https://`);
	const key = text(endpoint, "apiKey");
	// The browser only ever sees a masked key; sending it back unchanged keeps the stored one, but only for the
	// same endpoint, so a stored key is never sent somewhere new without being typed in again.
	let apiKey = key;
	if (key.startsWith(MASK)) {
		const previous = stored.providers.find((p) => p.id === id);
		if (previous !== undefined && previous.baseUrl !== baseUrl.replace(/\/+$/, "")) {
			throw new Invalid(`provider ${id}: enter the API key again after changing the base URL`);
		}
		apiKey = previous?.apiKey ?? "";
	}
	return {
		id,
		name: text(raw, "name") || id,
		kind,
		baseUrl: baseUrl.replace(/\/+$/, ""),
		apiKey,
		model,
		rpm: int(raw, "rpm", 0, 100_000, `provider ${id}: requests per minute`),
		rpd: int(raw, "rpd", 0, 10_000_000, `provider ${id}: requests per day`),
		concurrency: int(raw, "concurrency", 0, 100, `provider ${id}: concurrency`),
		priceIn: price(raw, "priceIn", `provider ${id}: input price`),
		priceOut: price(raw, "priceOut", `provider ${id}: output price`),
	};
}

/** Validate settings from the browser or the settings file (the trust boundary). */
export function parseSettings(input: unknown, stored: Settings): Settings | { error: string } {
	try {
		if (!isObj(input)) throw new Invalid("settings must be an object");
		if (!Array.isArray(input.providers)) throw new Invalid("providers must be a list");
		const providers = input.providers.map((p) => parseProvider(p, stored));
		const known = new Set(providers.map((p) => p.id));
		if (known.size !== providers.length) throw new Invalid("provider ids must be unique");
		const stagesIn = field(input, "stages");
		const stageList = (stage: Stage): string[] => {
			const list = stagesIn[stage];
			if (!Array.isArray(list)) throw new Invalid(`${stage} providers must be a list`);
			return list.map((id) => {
				if (typeof id !== "string" || !known.has(id)) throw new Invalid(`${stage} lists an unknown provider "${id}"`);
				return id;
			});
		};
		const reset = field(input, "quotaReset");
		const time = text(reset, "time");
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Invalid("quota reset time must be HH:MM");
		const timeZone = text(reset, "timeZone");
		if (timeZone !== "UTC" && !Intl.supportedValuesOf("timeZone").includes(timeZone)) {
			throw new Invalid(`quota reset time zone "${timeZone}" is not a known IANA zone`);
		}
		const promptsIn = isObj(input.prompts) ? input.prompts : {};
		const prompt = (key: keyof Prompts) => text(promptsIn, key) || DEFAULT_PROMPTS[key];
		return {
			providers,
			stages: { ocr: stageList("ocr"), proofread: stageList("proofread"), assemble: stageList("assemble") },
			pagesPerRequest: int(input, "pagesPerRequest", 1, 10, "pages per request"),
			imageMaxSide: int(input, "imageMaxSide", 800, 4000, "image size"),
			jpegQuality: int(input, "jpegQuality", 40, 100, "JPEG quality"),
			quotaReset: { time, timeZone },
			proofread: input.proofread === true,
			tesseractFallback: input.tesseractFallback === true,
			figures: input.figures === true,
			cleanScans: input.cleanScans === true,
			prompts: { ocr: prompt("ocr"), proofread: prompt("proofread"), metadata: prompt("metadata") },
			tocDepth: int(input, "tocDepth", 1, 6, "TOC depth"),
		};
	} catch (error) {
		if (error instanceof Invalid) return { error: error.message };
		throw error;
	}
}
