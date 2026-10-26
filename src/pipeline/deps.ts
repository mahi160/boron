import type { Settings } from "../settings.ts";
import type { Store } from "../store.ts";
import type { Limiter } from "./limiter.ts";

/** What the durable tasks need from the app. Passed in, so tests can build a pipeline on temp files. */
export type Deps = {
	store: Store;
	settings: () => Settings;
	limiter: Limiter;
	now: () => number;
	/** Called after any change to a book's rows, for live views. */
	changed: (bookId: string) => void;
	/** Path of a book's uploaded PDF. */
	sourcePdf: (bookId: string) => string;
	/** Path of a rendered page image. */
	pageImage: (bookId: string, page: number) => string;
	/** Offline OCR of page images, one text per image. */
	tesseract: (images: Buffer[]) => Promise<string[]>;
};
