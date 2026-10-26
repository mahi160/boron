import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, type FauxResponseStep, fauxProvider } from "@earendil-works/pi-ai";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import { context } from "../../src/harness.ts";
import { OcrPage, type OcrPageInput, type OcrPageResult } from "../../src/ocr-task.ts";
import { makePdf } from "./pdf.ts";

export async function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "boron-test-"));
}

export async function samplePdf(dir: string, pages = 3): Promise<string> {
	const path = join(dir, "book.pdf");
	await writeFile(path, makePdf(pages));
	return path;
}

/** Models with one image-capable faux model answering through `respond`. */
export function fauxModels(respond: FauxResponseStep) {
	const faux = fauxProvider({ models: [{ id: "faux-vision", input: ["text", "image"] }] });
	const models = createModels();
	models.setProvider(faux.provider);
	// Every request gets the same factory, however many are made.
	faux.setResponses(Array.from({ length: 50 }, () => respond));
	const model = faux.getModel();
	return { models, ref: { provider: model.provider, modelId: model.id } };
}

export async function startOcr(
	harness: Harness,
	input: Omit<OcrPageInput, "maxSide">,
): Promise<TaskId<OcrPageResult>> {
	const root = await harness.root(context);
	return root.commit(
		(tx) => tx.createTask(OcrPage, { ...input, maxSide: 400 }, { ownership: { kind: "conversation" } }),
		context,
	);
}
