import { isObj } from "./json.ts";

/** Where a local Ollama is looked for: the host itself, then the Docker host. */
const CANDIDATES = process.env.BORON_OLLAMA_URL ? [process.env.BORON_OLLAMA_URL] : ["http://localhost:11434", "http://host.docker.internal:11434"];

export type DetectedOllama = { baseUrl: string; models: string[] };

async function json(url: string, body?: unknown): Promise<unknown> {
	const init: RequestInit = { signal: AbortSignal.timeout(1_500) };
	if (body !== undefined) Object.assign(init, { method: "POST", body: JSON.stringify(body) });
	const response = await fetch(url, init);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response.json();
}

/** Whether `model` reads images; Ollama before capabilities existed gets the benefit of the doubt. */
async function hasVision(base: string, model: string): Promise<boolean> {
	const info = await json(`${base}/api/show`, { model }).catch(() => undefined);
	const capabilities = isObj(info) ? info.capabilities : undefined;
	return !Array.isArray(capabilities) || capabilities.includes("vision");
}

/** The first reachable Ollama with its vision models, or null when none answers. */
export async function detectOllama(): Promise<DetectedOllama | null> {
	for (const base of CANDIDATES.map((u) => u.replace(/\/+$/, ""))) {
		const tags = await json(`${base}/api/tags`).catch(() => undefined);
		if (!isObj(tags) || !Array.isArray(tags.models)) continue;
		const names = tags.models.flatMap((m) => (isObj(m) && typeof m.name === "string" ? [m.name] : []));
		const vision = await Promise.all(names.map(async (name) => ((await hasVision(base, name)) ? [name] : [])));
		return { baseUrl: `${base}/v1`, models: vision.flat() };
	}
	return null;
}
