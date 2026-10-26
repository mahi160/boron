import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type HarnessOptions, type Storage } from "@earendil-works/pi-durable";
import { BoronExtension } from "./ocr-task.ts";

export const context = BACKGROUND_CONTEXT;

/** Open a Harness with Boron's tasks installed. */
export async function openHarness(
	storage: Storage,
	models: Models,
	settings?: HarnessOptions["settings"],
): Promise<Harness> {
	const registry = createRegistry();
	registry.install(BoronExtension);
	return Harness.open(storage, { models, registry, settings }, context);
}
