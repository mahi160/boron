import { useState } from "react";
import { api, type BookDetail, urls, useLive } from "../api.ts";
import { count } from "../format.ts";
import { go, href, type Route } from "../router.ts";
import { BookStatus, isActive } from "../status.tsx";
import { Button, Confirm, ErrorLine, useAction } from "../ui.tsx";
import { Details } from "./details.tsx";
import { Job } from "./job.tsx";
import { Review } from "./review.tsx";
import { Structure } from "./structure.tsx";

type BookRoute = Extract<Route, { screen: "book" }>;

const TABS: { id: BookRoute["tab"]; label: string }[] = [
	{ id: "job", label: "Job" },
	{ id: "review", label: "Review" },
	{ id: "structure", label: "Chapters" },
	{ id: "details", label: "Details & cover" },
];

export function BookScreen({ route }: { route: BookRoute }) {
	const { data, error, reload } = useLive<BookDetail>(`/books/${route.id}`, route.id);
	const action = useAction();
	const [confirm, setConfirm] = useState<"abort" | "delete" | null>(null);

	if (data === undefined) {
		return error === null ? <p className="text-faint">Loading…</p> : <NotFound message={error} />;
	}
	const { book } = data;
	const control = (name: "pause" | "resume" | "abort") => action.run(() => api.post(`/books/${book.id}/${name}`).then(reload));
	const active = isActive(book.status);
	const read = book.done + book.flagged;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4">
				<a href="#/" className="w-fit text-sm text-muted hover:text-ink">
					← Library
				</a>
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<div className="flex items-center gap-3">
							<h1 className="bangla truncate text-2xl font-semibold">{book.title}</h1>
							<BookStatus status={book.status} />
						</div>
						<p className="mt-1 text-muted">
							{book.author !== "" && <span className="bangla">{book.author} · </span>}
							<span className="tabular-nums">
								{count(read)} of {count(book.pageCount)} pages read
							</span>
							{book.flagged > 0 && ` · ${book.flagged} to check`}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{active && (
							<>
								<Button disabled={action.busy} onClick={() => control("pause")}>
									Pause
								</Button>
								<Button disabled={action.busy} onClick={() => setConfirm("abort")}>
									Stop
								</Button>
							</>
						)}
						{(book.status === "paused" || book.status === "aborted" || book.status === "failed") && (
							<Button disabled={action.busy} onClick={() => control("resume")}>
								{book.status === "paused" ? "Resume" : "Continue reading"}
							</Button>
						)}
						{!active && (
							<Button variant="danger" onClick={() => setConfirm("delete")}>
								Delete
							</Button>
						)}
						{read > 0 && (
							<a href={urls.epub(book.id)} className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-sm font-medium text-white hover:bg-black">
								Download EPUB
							</a>
						)}
					</div>
				</div>
				<ErrorLine>{action.error ?? book.error}</ErrorLine>
				<nav aria-label="Book" className="flex gap-5 border-b border-border">
					{TABS.map((tab) => (
						<a
							key={tab.id}
							href={href({ ...route, tab: tab.id })}
							aria-current={route.tab === tab.id ? "page" : undefined}
							className={`-mb-px border-b-2 pb-2.5 text-sm ${route.tab === tab.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
						>
							{tab.label}
						</a>
					))}
				</nav>
			</div>

			{route.tab === "job" && <Job detail={data} reload={reload} />}
			{route.tab === "review" && <Review detail={data} reload={reload} page={Math.min(route.page, book.pageCount)} />}
			{route.tab === "structure" && <Structure book={book} />}
			{route.tab === "details" && <Details book={book} reload={reload} />}

			<Confirm
				open={confirm === "abort"}
				title="Stop reading this book?"
				action="Stop"
				onConfirm={() => void control("abort")}
				onClose={() => setConfirm(null)}
			>
				Requests in flight are cancelled. The {count(read)} pages already read are kept, and you can continue later.
			</Confirm>
			<Confirm
				open={confirm === "delete"}
				title={`Delete “${book.title}”?`}
				action="Delete book"
				danger
				onConfirm={() => void action.run(() => api.delete(`/books/${book.id}`).then(() => go({ screen: "library" })))}
				onClose={() => setConfirm(null)}
			>
				The PDF, its page images, all text and your edits are removed. This cannot be undone.
			</Confirm>
		</div>
	);
}

function NotFound({ message }: { message: string }) {
	return (
		<div className="flex flex-col gap-2">
			<h1 className="text-2xl font-semibold">Book not found</h1>
			<p className="text-muted">{message}</p>
			<a href="#/" className="text-sm underline">
				Back to the library
			</a>
		</div>
	);
}
