import { diffWords } from "diff";
import { useMemo, useState } from "react";
import { api, type BookDetail, type PageRow, useLive } from "../api.ts";
import { renderPage } from "../markdown.ts";
import { go } from "../router.ts";
import { PageStatusPill } from "../status.tsx";
import { Button, Card, Confirm, ErrorLine, useAction } from "../ui.tsx";

type View = "edit" | "preview" | "changes";
const VIEW_LABELS: Record<View, string> = { edit: "Edit", preview: "Preview", changes: "Draft → polished" };

/** HTML of a chunk's Markdown, with its `images/<file>` links served by the API. */
function render(bookId: string, markdown: string): string {
	return renderPage(markdown.replace(/\]\(images\//g, `](/api/books/${bookId}/images/`), () => "");
}

/** The chunk's Bangla as the EPUB will use it: the user's edit, else the polished text, else the draft. */
const current = (row: PageRow) => row.edited ?? row.proofread?.markdown ?? row.raw?.markdown ?? "";

/** One chunk of a translation book: the English beside the editable Bangla, and the polish pass's changes. */
export function TranslateReview({ detail, reload, chunk }: { detail: BookDetail; reload: () => Promise<void>; chunk: number }) {
	const { book } = detail;
	const { data: row, error } = useLive<PageRow>(book.pageCount === 0 ? null : `/books/${book.id}/pages/${chunk}`, book.id);
	const goTo = (n: number) => go({ screen: "book", id: book.id, tab: "review", page: Math.min(Math.max(1, n), book.pageCount) });

	if (book.pageCount === 0) return <p className="text-faint">The book is not split into chunks yet.</p>;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={chunk <= 1} onClick={() => goTo(chunk - 1)}>
					← Previous
				</Button>
				<label className="flex items-center gap-2 text-sm text-muted">
					Chunk
					<input
						type="number"
						min={1}
						max={book.pageCount}
						value={chunk}
						onChange={(e) => goTo(Number(e.target.value))}
						className="w-20 tabular-nums"
					/>
					of {book.pageCount}
				</label>
				<Button disabled={chunk >= book.pageCount} onClick={() => goTo(chunk + 1)}>
					Next →
				</Button>
			</div>
			<ErrorLine>{error}</ErrorLine>
			{row === undefined ? <p className="text-faint">Loading…</p> : <ChunkEditor key={row.page} bookId={book.id} row={row} refresh={reload} />}
		</div>
	);
}

function ChunkEditor({ bookId, row, refresh }: { bookId: string; row: PageRow; refresh: () => Promise<void> }) {
	const saved = current(row);
	const [draft, setDraft] = useState(saved);
	const [base, setBase] = useState(saved);
	const [view, setView] = useState<View>("edit");
	const [confirm, setConfirm] = useState(false);
	const save = useAction();
	// A re-run finishing replaces the shown text unless the user has unsaved changes.
	if (base !== saved) {
		if (draft === base) setDraft(saved);
		setBase(saved);
	}
	const dirty = draft !== saved;
	const changes = useMemo(() => {
		if (row.raw === null || row.proofread === null) return null;
		return diffWords(row.raw.markdown, row.proofread.markdown, { intlSegmenter: new Intl.Segmenter("bn", { granularity: "word" }) });
	}, [row.raw, row.proofread]);
	const views: View[] = changes === null ? ["edit", "preview"] : ["edit", "preview", "changes"];
	const put = (markdown: string | null) => save.run(() => api.put(`/books/${bookId}/pages/${row.page}`, { markdown }).then(refresh));

	return (
		<div className="grid items-start gap-4 lg:grid-cols-2">
			<Card title={`English, chunk ${row.page}`}>
				<div
					lang="en"
					className="page-preview max-h-[75vh] min-h-[60vh] overflow-y-auto p-5 text-[16px]"
					// markdown-it with raw HTML off escapes the text; only Markdown's own tags come through.
					dangerouslySetInnerHTML={{ __html: render(bookId, row.source ?? "") }}
				/>
			</Card>
			<Card
				title={
					<span className="flex items-center gap-2">
						Bangla <PageStatusPill status={row.status} />
						{row.edited !== null && <span className="text-xs font-normal text-faint">edited by you</span>}
					</span>
				}
				aside={
					<div role="tablist" className="flex rounded-full bg-raised p-0.5">
						{views.map((v) => (
							<button
								key={v}
								type="button"
								role="tab"
								aria-selected={view === v}
								onClick={() => setView(v)}
								className={`h-7 rounded-full px-3 text-xs font-medium ${view === v ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted"}`}
							>
								{VIEW_LABELS[v]}
							</button>
						))}
					</div>
				}
			>
				<div className="flex flex-col gap-3 p-5">
					{row.flag !== null && <p className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-ink">{row.flag}</p>}
					{view === "changes" && changes !== null ? (
						<div className="bangla min-h-[60vh] rounded-md border border-border p-3 text-[17px] whitespace-pre-wrap">
							{changes.map((part, i) =>
								part.removed ? (
									<del key={i} className="bg-neg-bg text-neg-ink">
										{part.value}
									</del>
								) : part.added ? (
									<ins key={i} className="bg-pos-bg text-pos-ink no-underline">
										{part.value}
									</ins>
								) : (
									<span key={i}>{part.value}</span>
								),
							)}
						</div>
					) : view === "preview" ? (
						<div lang="bn" className="bangla page-preview min-h-[60vh] rounded-md border border-border p-3 text-[17px]" dangerouslySetInnerHTML={{ __html: render(bookId, draft) }} />
					) : (
						<textarea
							lang="bn"
							aria-label={`Bangla text of chunk ${row.page} (Markdown)`}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							className="bangla min-h-[60vh] text-[17px] leading-7"
						/>
					)}
					<ErrorLine>{save.error}</ErrorLine>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="ghost" disabled={save.busy} onClick={() => setConfirm(true)}>
							Translate again
						</Button>
						{row.edited !== null && (
							<Button disabled={save.busy || dirty} onClick={() => put(null)}>
								Use the model's text
							</Button>
						)}
						<Button disabled={!dirty || save.busy} onClick={() => setDraft(saved)}>
							Discard
						</Button>
						<Button variant="primary" disabled={!dirty || save.busy} onClick={() => put(draft)}>
							Save
						</Button>
					</div>
				</div>
			</Card>
			<Confirm
				open={confirm}
				title={`Translate chunk ${row.page} again?`}
				action="Translate again"
				onConfirm={() => void save.run(() => api.post(`/books/${bookId}/rerun`, { pages: [row.page] }).then(refresh))}
				onClose={() => setConfirm(false)}
			>
				The chunk is translated again with the current glossary; your edit of it is replaced. It counts against the providers' limits like any request.
			</Confirm>
		</div>
	);
}
