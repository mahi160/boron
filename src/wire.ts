// Shapes the HTTP API sends that are not store rows. The server builds them with `satisfies`, the web reads them.
import type { PageLabel } from "./page-labels.ts";
import type { BatchRow, Book, PageSummary, Parked, TocEntry } from "./store.ts";

/** A book as the library lists it (`libraryEntry`). */
export type LibraryBook = Book & {
	done: number;
	flagged: number;
	failed: number;
	/** Proofreading suggestions waiting for a decision, over all pages. */
	suggestions: number;
	nextWake: number | null;
	inputTokens: number;
	outputTokens: number;
};

export type BookDetail = {
	book: LibraryBook;
	/** `label`: the page's printed label (`pageLabels`), null if it has none. */
	pages: (PageSummary & { label: PageLabel | null })[];
	batches: BatchRow[];
	parked: Parked[];
	exhausted: { provider: string; name: string; until: number }[];
};

export type TocResponse = { proposed: TocEntry[]; toc: TocEntry[]; edited: boolean };
