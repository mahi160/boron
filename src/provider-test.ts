import { providerModels } from "./models.ts";
import type { ProviderConfig } from "./settings.ts";

export type ProviderTestResult = { ok: true; text: string; ms: number } | { ok: false; error: string };

/** Send one sample page image straight to a provider (not through the job pipeline) and report what came back. */
export async function testProvider(p: ProviderConfig, image: Buffer): Promise<ProviderTestResult> {
	const models = providerModels(p);
	const model = models.getModel(p.id, p.model);
	if (model === undefined) return { ok: false, error: `model ${p.model} is not available` };
	const started = Date.now();
	// The simple API, as the pipeline uses through pi-durable: no reasoning level means thinking off.
	const answer = await models.completeSimple(
		model,
		{
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Transcribe the first three lines of text in this image. Answer with the text only." },
						{ type: "image", data: image.toString("base64"), mimeType: "image/jpeg" },
					],
					timestamp: started,
				},
			],
		},
		{ signal: AbortSignal.timeout(90_000) },
	);
	if (answer.stopReason === "error" || answer.stopReason === "aborted") {
		return { ok: false, error: answer.errorMessage ?? `request ${answer.stopReason}` };
	}
	const text = answer.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
	return { ok: true, text, ms: Date.now() - started };
}
