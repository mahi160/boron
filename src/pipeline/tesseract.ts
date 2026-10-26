import { mkdir } from "node:fs/promises";
import { createWorker, OEM, type Worker } from "tesseract.js";

let worker: Promise<Worker> | undefined;

/**
 * Offline OCR with Tesseract (WASM) and its Bangla model. The model is downloaded once into `cachePath`
 * (the Docker image ships it there already).
 */
export function createTesseract(cachePath: string) {
	return async (images: string[]): Promise<string[]> => {
		worker ??= mkdir(cachePath, { recursive: true })
			.then(() => createWorker("ben", OEM.LSTM_ONLY, { cachePath }))
			.catch((error: unknown) => {
				// Try again next time (e.g. the model download failed while offline).
				worker = undefined;
				throw error;
			});
		const w = await worker;
		const texts: string[] = [];
		for (const image of images) {
			const { data } = await w.recognize(image);
			// Tesseract breaks lines as printed; join each paragraph back into one line.
			texts.push(
				data.text
					.split(/\n\s*\n/)
					.map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
					.filter((paragraph) => paragraph !== "")
					.join("\n\n"),
			);
		}
		return texts;
	};
}
