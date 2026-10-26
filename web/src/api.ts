import { useCallback, useEffect, useRef, useState } from "react";
import type { Figure, PageResult } from "../../src/pipeline/contract.ts";
import type { PageLabel } from "../../src/page-labels.ts";
import type { ProviderTestResult } from "../../src/provider-test.ts";
import type { ProviderConfig, Settings } from "../../src/settings.ts";
import type { BatchRow, Book, Cover, PageRow, PageStatus, PageSummary, Parked, TocEntry } from "../../src/store.ts";

export type { BatchRow, Book, Cover, Figure, PageLabel, PageResult, PageRow, PageStatus, PageSummary, Parked, ProviderConfig, ProviderTestResult, Settings, TocEntry };

/** A book as the library lists it (`libraryEntry` on the server). */
export type LibraryBook = Book & {
	done: number;
	flagged: number;
	failed: number;
	nextWake: number | null;
	inputTokens: number;
	outputTokens: number;
};

export type BookDetail = {
	book: LibraryBook;
	/** `label`: the page's printed label (`pageLabels` on the server), null if it has none. */
	pages: (PageSummary & { label: PageLabel | null })[];
	batches: BatchRow[];
	parked: Parked[];
	exhausted: { provider: string; name: string; until: number }[];
};

export type TocResponse = { proposed: TocEntry[]; toc: TocEntry[]; edited: boolean };

export class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
	const init: RequestInit = { method };
	if (body instanceof FormData) init.body = body;
	else if (body !== undefined) {
		init.body = JSON.stringify(body);
		init.headers = { "content-type": "application/json" };
	}
	const response = await fetch(`/api${path}`, init);
	const data: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const message = typeof data === "object" && data !== null && "error" in data ? String(data.error) : response.statusText;
		throw new ApiError(message);
	}
	return data as T;
}

export const api = {
	get: <T>(path: string) => call<T>("GET", path),
	post: <T>(path: string, body?: unknown) => call<T>("POST", path, body),
	put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
	delete: <T>(path: string) => call<T>("DELETE", path),
};

export const urls = {
	pageImage: (bookId: string, page: number) => `/api/books/${bookId}/pages/${page}/image`,
	figure: (bookId: string, page: number, index: number, version: string) =>
		`/api/books/${bookId}/pages/${page}/figures/${index}?v=${encodeURIComponent(version)}`,
	cover: (bookId: string, version: string) => `/api/books/${bookId}/cover?v=${encodeURIComponent(version)}`,
	epub: (bookId: string) => `/api/books/${bookId}/epub`,
};

/** One shared EventSource; listeners hear the id of every book that changed. */
const listeners = new Set<(bookId: string) => void>();
let source: EventSource | undefined;
function subscribe(listener: (bookId: string) => void) {
	listeners.add(listener);
	if (source === undefined) {
		source = new EventSource("/api/events");
		source.addEventListener("book", (event) => {
			for (const l of listeners) l(event.data);
		});
		// After a reconnect, refetch everything: changes may have been missed.
		source.addEventListener("open", () => {
			for (const l of listeners) l("*");
		});
	}
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Fetch `path` and refetch it whenever the server reports a change to `bookId` ("*" = any book).
 * Returns the data, the last error, and a reload function.
 */
export function useLive<T>(path: string | null, bookId: string) {
	const [state, setState] = useState<{ path: string | null; data?: T; error: string | null }>({ path, error: null });
	// Refetches overlap when changes come quickly; only the newest response is applied.
	const latest = useRef(0);
	const load = useCallback(async () => {
		if (path === null) return;
		const request = ++latest.current;
		try {
			const data = await api.get<T>(path);
			if (request === latest.current) setState({ path, data, error: null });
		} catch (e) {
			if (request === latest.current) setState((s) => ({ path, data: s.path === path ? s.data : undefined, error: e instanceof Error ? e.message : String(e) }));
		}
	}, [path]);
	useEffect(() => {
		void load();
		return subscribe((changed) => {
			if (bookId === "*" || changed === "*" || changed === bookId) void load();
		});
	}, [load, bookId]);
	// Data fetched for another path is not shown for this one.
	const current = state.path === path;
	return { data: current ? state.data : undefined, error: current ? state.error : null, reload: load };
}
