/** What a failed model request means for scheduling. */
export type ErrorKind =
	| { kind: "rate"; retryAfterMs: number }
	| { kind: "quota" }
	| { kind: "other" };

const MIN_RETRY_MS = 5_000;
const DEFAULT_RETRY_MS = 30_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function parse(text: string): Json | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function get(value: Json | undefined, key: string): Json | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value[key] : undefined;
}

/** Gemini errors arrive as {"error":{"message":"<the API's JSON body>"}}; return the inner body's `error`. */
function innerError(text: string): Json | undefined {
	const outer = parse(text);
	const message = get(get(outer, "error"), "message");
	const inner = typeof message === "string" ? (parse(message) ?? outer) : outer;
	return get(inner, "error") ?? get(outer, "error");
}

function geminiDetails(text: string): Json[] {
	const details = get(innerError(text), "details");
	return Array.isArray(details) ? details : [];
}

/** The human-readable part of a provider's error text, for display. */
export function errorMessage(text: string): string {
	const error = innerError(text);
	const message = get(error, "message");
	if (typeof message !== "string") return text;
	const code = get(error, "code");
	return typeof code === "number" ? `${code}: ${message}` : message;
}

function seconds(duration: string): number | undefined {
	const match = /^([\d.]+)s$/.exec(duration);
	return match?.[1] === undefined ? undefined : Number(match[1]) * 1000;
}

/** Classify the error text of an unanswered model request (see PLAN.md, spike findings). */
export function classifyError(text: string): ErrorKind {
	const details = geminiDetails(text);
	const quotaIds = details.flatMap((d) => {
		const violations = get(d, "violations");
		return Array.isArray(violations) ? violations.map((v) => String(get(v, "quotaId") ?? "")) : [];
	});
	if (quotaIds.some((id) => /PerDay/i.test(id))) return { kind: "quota" };
	if (quotaIds.length > 0) {
		const delay = details.map((d) => get(d, "retryDelay")).find((v) => typeof v === "string");
		const ms = typeof delay === "string" ? seconds(delay) : undefined;
		return { kind: "rate", retryAfterMs: Math.max(MIN_RETRY_MS, ms ?? DEFAULT_RETRY_MS) };
	}
	if (/insufficient_quota|per.?day|daily|billing/i.test(text)) return { kind: "quota" };
	if (/\b429\b|rate.?limit|too many requests|resource.?exhausted/i.test(text)) {
		return { kind: "rate", retryAfterMs: DEFAULT_RETRY_MS };
	}
	return { kind: "other" };
}
