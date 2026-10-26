import type { BatchRow, Book, PageStatus } from "./api.ts";
import { Pill, type Tone } from "./ui.tsx";

const BOOK: Record<Book["status"], [Tone, string]> = {
	rendering: ["data", "Rendering"],
	running: ["data", "Reading"],
	paused: ["neutral", "Paused"],
	aborted: ["neutral", "Stopped"],
	ready: ["positive", "Ready"],
	failed: ["negative", "Failed"],
};

const PAGE: Record<PageStatus, [Tone, string]> = {
	pending: ["neutral", "Pending"],
	done: ["positive", "Done"],
	flagged: ["warning", "Check"],
	failed: ["negative", "Failed"],
};

const BATCH: Record<BatchRow["state"], [Tone, string]> = {
	queued: ["neutral", "Queued"],
	running: ["data", "Running"],
	waiting: ["warning", "Waiting"],
	retrying: ["warning", "Retrying"],
	done: ["positive", "Done"],
	failed: ["negative", "Failed"],
	aborted: ["neutral", "Stopped"],
};

export const BookStatus = ({ status }: { status: Book["status"] }) => <Pill tone={BOOK[status][0]}>{BOOK[status][1]}</Pill>;
export const PageStatusPill = ({ status }: { status: PageStatus }) => <Pill tone={PAGE[status][0]}>{PAGE[status][1]}</Pill>;
export const BatchState = ({ state }: { state: BatchRow["state"] }) => <Pill tone={BATCH[state][0]}>{BATCH[state][1]}</Pill>;

export const isActive = (status: Book["status"]) => status === "rendering" || status === "running";
