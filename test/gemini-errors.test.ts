// What an `unanswered` OCR submission exposes for Gemini errors, through pi-ai's real google-generative-ai API against
// a local server. PER_MINUTE and UNAVAILABLE are bodies captured live on 2026-10-26 (free tier). PER_DAY is PER_MINUTE
// with the daily quotaId and description swapped in: a daily 429 was not captured live.
// Gemini's streaming endpoint sends errors without a JSON content type, so @google/genai nests the body as a string
// inside {"error":{"message","code","status"}}; the stub does the same.
import { createServer, type Server } from "node:http";
import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { context, openHarness } from "../src/harness.ts";
import { samplePdf, startOcr, tempDir } from "./helpers/ocr.ts";

function quota429(quotaId: string, description: string): string {
	const body = {
		error: {
			code: 429,
			message: `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.5-flash-lite, description: ${description}\nPlease retry in 278.145635ms.`,
			status: "RESOURCE_EXHAUSTED",
			details: [
				{
					"@type": "type.googleapis.com/google.rpc.Help",
					links: [
						{
							description: "Learn more about Gemini API quotas",
							url: "https://ai.google.dev/gemini-api/docs/rate-limits",
						},
					],
				},
				{
					"@type": "type.googleapis.com/google.rpc.QuotaFailure",
					violations: [
						{
							description,
							quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
							quotaId,
							quotaDimensions: { location: "global", model: "gemini-3.5-flash-lite" },
							quotaValue: "15",
						},
					],
				},
				{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0s" },
			],
		},
	};
	return `${JSON.stringify(body, null, 2)}\n`;
}

const PER_MINUTE = {
	status: 429,
	body: quota429(
		"GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
		"Generate content requests per minute limit exceeded on Free Tier. See https://ai.google.dev/gemini-api/docs/rate-limits.",
	),
};
const PER_DAY = {
	status: 429,
	body: quota429(
		"GenerateRequestsPerDayPerProjectPerModel-FreeTier",
		"Generate content requests per day limit exceeded on Free Tier. See https://ai.google.dev/gemini-api/docs/rate-limits.",
	),
};
const UNAVAILABLE = {
	status: 503,
	body: `${JSON.stringify(
		{
			error: {
				code: 503,
				message:
					"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
				status: "UNAVAILABLE",
			},
		},
		null,
		2,
	)}\n`,
};

let server: Server;
let baseUrl: string;
let reply = PER_MINUTE;
let hits = 0;

beforeAll(async () => {
	server = createServer((request, response) => {
		hits++;
		request.resume();
		response.writeHead(reply.status, { "content-type": "text/event-stream" });
		response.end(reply.body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("stub server has no port");
	baseUrl = `http://127.0.0.1:${address.port}/v1beta`;
	vi.stubEnv("BORON_STUB_GEMINI_KEY", "stub");
});
afterAll(async () => {
	vi.unstubAllEnvs();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function ocrAgainstStub(response: typeof PER_MINUTE) {
	reply = response;
	hits = 0;
	const catalog = createModels();
	catalog.setProvider(googleProvider());
	const gemini = catalog.getModel("google", "gemini-3.5-flash-lite");
	if (gemini === undefined) throw new Error("gemini-3.5-flash-lite missing from the pi-ai catalog");
	const models = createModels();
	models.setProvider(
		createProvider({
			id: "stub-google",
			baseUrl,
			auth: { apiKey: envApiKeyAuth("Stub Gemini key", ["BORON_STUB_GEMINI_KEY"]) },
			models: [{ ...gemini, provider: "stub-google", baseUrl }],
			api: googleGenerativeAIApi(),
		}),
	);
	const harness = await openHarness(new MemoryStorage(), models, { retry: { baseDelayMs: 1, maxAgentDelayMs: 1 } });
	try {
		const pdfPath = await samplePdf(await tempDir(), 1);
		const id = await startOcr(harness, { pdfPath, page: 1, model: { provider: "stub-google", modelId: gemini.id } });
		return (await harness.waitForTask(id, context)).state.outcome;
	} finally {
		await harness.close(context);
	}
}

/** The provider error text a failed OcrPage outcome carries. */
function providerError(outcome: Awaited<ReturnType<typeof ocrAgainstStub>>): string {
	if (outcome.status !== "failed") throw new Error(`expected failed, got ${outcome.status}`);
	const detail = outcome.error.detail;
	if (typeof detail !== "object" || detail === null || Array.isArray(detail)) throw new Error("no detail");
	expect(detail.reason).toBe("model_error");
	if (typeof detail.detail !== "string") throw new Error("no provider error text");
	return detail.detail;
}

describe("Gemini errors through pi-ai and pi-durable", () => {
	it.each([
		["per-minute", PER_MINUTE, "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"],
		["daily", PER_DAY, "GenerateRequestsPerDayPerProjectPerModel-FreeTier"],
	])("a %s 429 fails at once (no retry) with the nested Gemini body naming its quotaId", async (_, response, quotaId) => {
		const text = providerError(await ocrAgainstStub(response));
		expect(hits).toBe(1);
		expect(JSON.parse(text)).toEqual({
			error: { code: 429, status: "Too Many Requests", message: response.body },
		});
		expect(JSON.parse(response.body)).toMatchObject({
			error: {
				status: "RESOURCE_EXHAUSTED",
				details: expect.arrayContaining([
					expect.objectContaining({ violations: [expect.objectContaining({ quotaId })] }),
				]),
			},
		});
	});

	it("a 503 is retried by pi-durable before the submission settles unanswered", async () => {
		const text = providerError(await ocrAgainstStub(UNAVAILABLE));
		expect(hits).toBe(4);
		expect(JSON.parse(text)).toEqual({
			error: { code: 503, status: "Service Unavailable", message: UNAVAILABLE.body },
		});
	});
});
