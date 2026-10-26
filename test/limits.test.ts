import { describe, expect, it } from "vitest";
import { classifyError, errorMessage } from "../src/pipeline/errors.ts";
import { createLimiter } from "../src/pipeline/limiter.ts";
import { resetBounds } from "../src/pipeline/reset.ts";
import type { ProviderConfig } from "../src/settings.ts";
import { openStore } from "../src/store.ts";

// Captured live from Gemini's streaming endpoint (see PLAN.md, spike findings), as pi-ai reports it.
function geminiQuotaError(quotaId: string, retryDelay = "0s"): string {
	const inner = {
		error: {
			code: 429,
			message: "You exceeded your current quota... * Quota exceeded for metric: ..., limit: 15\nPlease retry in 278.145635ms.",
			status: "RESOURCE_EXHAUSTED",
			details: [
				{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaValue: "15" }] },
				{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
			],
		},
	};
	return JSON.stringify({ error: { message: JSON.stringify(inner, null, 2), code: 429, status: "Too Many Requests" } });
}

describe("classifyError", () => {
	it("reads a Gemini per-minute 429 as a rate limit with its retry delay", () => {
		expect(classifyError(geminiQuotaError("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "38s"))).toEqual({
			kind: "rate",
			retryAfterMs: 38_000,
		});
	});

	it("waits at least a few seconds when Gemini says retry in 0s", () => {
		expect(classifyError(geminiQuotaError("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"))).toEqual({
			kind: "rate",
			retryAfterMs: 5_000,
		});
	});

	it("reads a Gemini per-day 429 as an exhausted quota", () => {
		expect(classifyError(geminiQuotaError("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).toEqual({ kind: "quota" });
	});

	it("reads OpenAI-style errors", () => {
		expect(classifyError("429 Rate limit reached for requests")).toEqual({ kind: "rate", retryAfterMs: 30_000 });
		expect(classifyError("429 You exceeded your current quota (insufficient_quota)")).toEqual({ kind: "quota" });
		expect(classifyError("503 model overloaded")).toEqual({ kind: "other" });
	});
});

describe("errorMessage", () => {
	it("shows the message inside a nested Gemini error (captured live)", () => {
		const text = JSON.stringify({
			error: {
				message: '{\n  "error": {\n    "code": 503,\n    "message": "This model is currently experiencing high demand.",\n    "status": "UNAVAILABLE"\n  }\n}\n',
				code: 503,
				status: "Service Unavailable",
			},
		});
		expect(errorMessage(text)).toBe("503: This model is currently experiencing high demand.");
	});

	it("keeps text that is not JSON", () => {
		expect(errorMessage("connect ECONNREFUSED 127.0.0.1:11434")).toBe("connect ECONNREFUSED 127.0.0.1:11434");
	});
});

describe("resetBounds", () => {
	it("finds the previous and next midnight in Los Angeles", () => {
		// 2026-10-26 15:00 UTC is 08:00 PDT (UTC-7).
		const now = Date.UTC(2026, 9, 26, 15, 0);
		expect(resetBounds(now, "00:00", "America/Los_Angeles")).toEqual({
			previous: Date.UTC(2026, 9, 26, 7, 0),
			next: Date.UTC(2026, 9, 27, 7, 0),
		});
	});

	it("crosses a DST change (PDT to PST on 2026-11-01)", () => {
		const now = Date.UTC(2026, 10, 1, 12, 0);
		expect(resetBounds(now, "00:00", "America/Los_Angeles")).toEqual({
			previous: Date.UTC(2026, 10, 1, 7, 0),
			next: Date.UTC(2026, 10, 2, 8, 0),
		});
	});

	it("uses today's reset when it is still ahead", () => {
		const now = Date.UTC(2026, 9, 26, 5, 0);
		expect(resetBounds(now, "06:30", "UTC")).toEqual({
			previous: Date.UTC(2026, 9, 25, 6, 30),
			next: Date.UTC(2026, 9, 26, 6, 30),
		});
	});
});

describe("limiter", () => {
	const provider = (limits: Partial<ProviderConfig>): ProviderConfig => ({
		id: "p",
		name: "p",
		kind: "openai",
		baseUrl: "http://localhost",
		apiKey: "",
		model: "m",
		rpm: 0,
		rpd: 0,
		concurrency: 0,
		priceIn: null,
		priceOut: null,
		...limits,
	});
	const reset = { time: "00:00", timeZone: "UTC" };

	it("allows rpm requests per minute, then says when the oldest leaves the window", () => {
		let now = Date.UTC(2026, 0, 1, 12, 0, 0);
		const limiter = createLimiter(openStore(":memory:"), () => now);
		const p = provider({ rpm: 2 });
		expect(limiter.acquire(p, 1, reset)).toEqual({ ok: true });
		now += 10_000;
		expect(limiter.acquire(p, 2, reset)).toEqual({ ok: true });
		now += 10_000;
		expect(limiter.acquire(p, 3, reset)).toEqual({ ok: false, until: Date.UTC(2026, 0, 1, 12, 1, 0), reason: "rpm" });
		now = Date.UTC(2026, 0, 1, 12, 1, 0);
		expect(limiter.acquire(p, 3, reset)).toEqual({ ok: true });
	});

	it("stops at rpd until the next quota reset, and the count survives a new limiter", () => {
		const now = Date.UTC(2026, 0, 1, 12, 0, 0);
		const store = openStore(":memory:");
		const p = provider({ rpd: 1 });
		expect(createLimiter(store, () => now).acquire(p, 1, reset)).toEqual({ ok: true });
		expect(createLimiter(store, () => now + 1000).acquire(p, 2, reset)).toEqual({
			ok: false,
			until: Date.UTC(2026, 0, 2),
			reason: "rpd",
		});
	});

	it("limits requests in flight and frees the slot on release", () => {
		const now = Date.UTC(2026, 0, 1);
		const limiter = createLimiter(openStore(":memory:"), () => now);
		const p = provider({ concurrency: 1 });
		expect(limiter.acquire(p, 1, reset)).toEqual({ ok: true });
		expect(limiter.acquire(p, 2, reset)).toMatchObject({ ok: false, reason: "concurrency" });
		limiter.release(1);
		expect(limiter.acquire(p, 2, reset)).toEqual({ ok: true });
	});
});
