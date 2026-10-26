export type Obj = Record<string, unknown>;

export function isObj(value: unknown): value is Obj {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse JSON, or `undefined` when it is not JSON. */
export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** The body of a Markdown code fence around a model's JSON answer, or the whole text. */
export function unfence(text: string): string {
	return (/```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text)?.[1] ?? text).trim();
}
