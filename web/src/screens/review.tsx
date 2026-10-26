import { diffWords } from "diff";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BookDetail, type Figure, type PageRow, urls, useLive } from "../api.ts";
import { PageWithBoxes } from "../figure-boxes.tsx";
import { pageRanges } from "../format.ts";
import { renderPage } from "../markdown.ts";
import { compact, expand } from "../paragraphs.ts";
import { go } from "../router.ts";
import { PageStatusPill } from "../status.tsx";
import { Button, Card, Confirm, ErrorLine, useAction } from "../ui.tsx";

type View = "edit" | "preview" | "changes";
const VIEW_LABELS: Record<View, string> = { edit: "Edit", preview: "Preview", changes: "Proofreading changes" };

/** What the edit box shows for some Markdown: one line per paragraph where that turns back into the same Markdown. */
const shownText = (markdown: string) => compact(markdown) ?? markdown;

export function Review({ detail, page, reload }: { detail: BookDetail; page: number; reload: () => Promise<void> }) {
	const { book, pages, batches } = detail;
	const summary = pages.find((p) => p.page === page);
	const { data: row, error, reload: reloadPage } = useLive<PageRow>(`/books/${book.id}/pages/${page}`, book.id);
	const toDecide = pages.filter((p) => p.pending > 0).map((p) => p.page);
	const nextToDecide = toDecide.find((p) => p > page) ?? toDecide[0];
	const to = (p: number) => go({ screen: "book", id: book.id, tab: "review", page: p });
	const toCheck = pages.filter((p) => p.status === "flagged" || p.status === "failed").map((p) => p.page);
	const nextToCheck = toCheck.find((p) => p > page) ?? toCheck[0];

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey) return;
			if (e.key === "ArrowLeft" && page > 1) to(page - 1);
			if (e.key === "ArrowRight" && page < book.pageCount) to(page + 1);
		};
		addEventListener("keydown", onKey);
		return () => removeEventListener("keydown", onKey);
	});

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={page <= 1} onClick={() => to(page - 1)} aria-label="Previous page (Alt+←)">
					←
				</Button>
				<label className="flex items-center gap-2 text-muted">
					Page
					<input
						type="number"
						min={1}
						max={book.pageCount}
						defaultValue={page}
						key={page}
						className="w-20 tabular-nums"
						onKeyDown={(e) => {
							const value = Number(e.currentTarget.value);
							if (e.key === "Enter" && value >= 1 && value <= book.pageCount) to(value);
						}}
					/>
					<span className="tabular-nums">of {book.pageCount}</span>
				</label>
				{summary !== undefined && <PrintedLabel key={`${page}:${summary.label?.label}:${summary.pageLabel}`} bookId={book.id} summary={summary} reload={reload} />}
				<Button disabled={page >= book.pageCount} onClick={() => to(page + 1)} aria-label="Next page (Alt+→)">
					→
				</Button>
				{nextToCheck !== undefined && (
					<Button variant="ghost" onClick={() => to(nextToCheck)}>
						Next page to check ({toCheck.length})
					</Button>
				)}
				{nextToDecide !== undefined && (
					<Button variant="ghost" onClick={() => to(nextToDecide)}>
						Next suggestions ({book.suggestions} on {toDecide.length} {toDecide.length === 1 ? "page" : "pages"})
					</Button>
				)}
			</div>
			{row === undefined ? (
				error === null ? <p className="text-faint">Loading page…</p> : <ErrorLine>{error}</ErrorLine>
			) : (
				<PageEditor
					key={`${book.id}:${page}`}
					bookId={book.id}
					row={row}
					printed={summary?.label?.label ?? ""}
					batchPages={batches.findLast((b) => b.job === "pages" && b.pages.includes(page))?.pages ?? [page]}
					saved={() => Promise.all([reloadPage(), reload()]).then(() => undefined)}
				/>
			)}
		</div>
	);
}

const LABEL_SOURCE = { printed: "read from the page", inferred: "counted from nearby pages", edited: "set by you" } as const;

/** The printed page number of a PDF page; Enter or leaving the field saves it, empty means the page has none. */
function PrintedLabel({ bookId, summary, reload }: { bookId: string; summary: BookDetail["pages"][number]; reload: () => Promise<void> }) {
	const current = summary.label?.label ?? "";
	const [value, setValue] = useState(current);
	const save = useAction();
	const put = (label: string | null) => save.run(() => api.put(`/books/${bookId}/pages/${summary.page}/label`, { label }).then(reload));
	const commit = () => {
		if (value.trim() !== current) void put(value.trim());
	};
	return (
		<div className="flex items-center gap-2 text-muted">
			<label className="flex items-center gap-2">
				Printed page
				<input
					value={value}
					maxLength={20}
					placeholder="none"
					className="bangla w-20 tabular-nums"
					onChange={(e) => setValue(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => e.key === "Enter" && commit()}
				/>
			</label>
			{summary.label !== null && <span className="text-xs text-faint">{LABEL_SOURCE[summary.label.source]}</span>}
			{summary.pageLabel !== null && (
				<Button variant="ghost" disabled={save.busy} onClick={() => void put(null)}>
					Use detected
				</Button>
			)}
			<ErrorLine>{save.error}</ErrorLine>
		</div>
	);
}

type Suggestion = NonNullable<PageRow["suggestions"]>[number];

/** A few words of `text` either side of `find`, for showing a suggestion in context. */
function around(text: string, find: string) {
	const at = text.indexOf(find);
	if (at === -1) return { before: "", after: "" };
	const words = (s: string) => s.replaceAll(/\s+/g, " ").split(" ");
	return { before: words(text.slice(0, at)).slice(-4).join(" "), after: words(text.slice(at + find.length)).slice(0, 4).join(" ") };
}

/**
 * Proofreading suggestions that change spelling only (\u09a8/\u09a3, vowel signs\u2026), which a model often makes to the author's
 * own spelling. Each is accepted or rejected here; until then the book keeps the text as the OCR read it.
 */
function Suggestions({
	bookId,
	page,
	raw,
	suggestions,
	locked,
	show,
	saved,
}: {
	bookId: string;
	page: number;
	raw: string;
	suggestions: Suggestion[];
	/** Unsaved edits in the text box; deciding would rewrite the text under them. */
	locked: boolean;
	show: (find: string) => void;
	saved: () => Promise<void>;
}) {
	const decide = useAction();
	const listed = suggestions.flatMap((s, index) => (s.status === "auto" ? [] : [{ ...s, index }]));
	const pending = listed.filter((s) => s.status === "pending");
	const decided = listed.filter((s) => s.status !== "pending");
	if (listed.length === 0) return null;
	const put = (decisions: { index: number; status: "accepted" | "rejected" }[]) =>
		decide.run(() =>
			api
				.put(`/books/${bookId}/pages/${page}/suggestions`, { decisions: decisions.map((d) => ({ ...d, find: suggestions[d.index]?.find })) })
				.then(saved),
		);
	const card = (s: (typeof listed)[number]) => {
		const { before, after } = around(raw, s.find);
		return (
			<li key={s.index} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
				<button type="button" className="bangla min-w-0 text-left text-[15px]" onClick={() => show(s.status === "accepted" ? s.replace : s.find)} title="Show in the text">
					<span className="text-faint">{before} </span>
					<del className="bg-neg-bg text-neg-ink">{s.find}</del>
					{" "}
					<ins className="bg-pos-bg text-pos-ink no-underline">{s.replace}</ins>
					<span className="text-faint"> {after}</span>
				</button>
				<span className="flex flex-none gap-1">
					{s.status === "pending" ? (
						<>
							<Button variant="ghost" disabled={locked || decide.busy} onClick={() => put([{ index: s.index, status: "accepted" }])}>
								Accept
							</Button>
							<Button variant="ghost" disabled={locked || decide.busy} onClick={() => put([{ index: s.index, status: "rejected" }])}>
								Keep as printed
							</Button>
						</>
					) : (
						<Button
							variant="ghost"
							disabled={locked || decide.busy}
							onClick={() => put([{ index: s.index, status: s.status === "accepted" ? "rejected" : "accepted" }])}
						>
							{s.status === "accepted" ? "Accepted \u00b7 undo" : "Kept \u00b7 undo"}
						</Button>
					)}
				</span>
			</li>
		);
	};
	return (
		<section aria-label="Proofreading suggestions" className="flex flex-col gap-2 rounded-md bg-raised p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm">
					{pending.length === 0 ? "All spelling suggestions decided." : `${pending.length} spelling ${pending.length === 1 ? "suggestion" : "suggestions"} to decide.`}{" "}
					<span className="text-faint">Until accepted, the book keeps the spelling as read from the scan.</span>
				</p>
				{pending.length > 1 && (
					<span className="flex gap-1">
						<Button variant="ghost" disabled={locked || decide.busy} onClick={() => put(pending.map((s) => ({ index: s.index, status: "accepted" })))}>
							Accept all
						</Button>
						<Button variant="ghost" disabled={locked || decide.busy} onClick={() => put(pending.map((s) => ({ index: s.index, status: "rejected" })))}>
							Keep all as printed
						</Button>
					</span>
				)}
			</div>
			{locked && <p className="text-xs text-faint">Save or discard your changes to the text first.</p>}
			<ul className="flex flex-col gap-1">{pending.map(card)}</ul>
			{decided.length > 0 && (
				<details>
					<summary className="cursor-pointer text-xs text-faint">Decided ({decided.length})</summary>
					<ul className="mt-1 flex flex-col gap-1">{decided.map(card)}</ul>
				</details>
			)}
			<ErrorLine>{decide.error}</ErrorLine>
		</section>
	);
}

/** The text a page currently uses, as `assemblyPages` on the server picks it. */
const modelText = (row: PageRow) => (row.proofread ?? row.raw)?.markdown ?? "";
const modelFigures = (row: PageRow): Figure[] => row.figures ?? (row.proofread ?? row.raw)?.figures ?? [];

function PageEditor({
	bookId,
	row,
	printed,
	batchPages,
	saved: refresh,
}: {
	bookId: string;
	row: PageRow;
	printed: string;
	batchPages: number[];
	/** Refetch the page and the book after a change the server does not announce. */
	saved: () => Promise<void>;
}) {
	const saved = row.edited ?? modelText(row);
	const shown = shownText(saved);
	const [draft, setDraft] = useState(shown);
	// Whether the draft is in the compact form, which needs its paragraph breaks back before saving.
	const [compactDraft, setCompactDraft] = useState(compact(saved) !== null);
	const reset = () => {
		setDraft(shown);
		setCompactDraft(compact(saved) !== null);
	};
	const markdownOf = (text: string) => (compactDraft ? expand(text) : text);
	const [view, setView] = useState<View>("edit");
	const [figures, setFigures] = useState<Figure[]>(modelFigures(row));
	const [selected, setSelected] = useState<number | null>(null);
	const [rerun, setRerun] = useState<number[] | null>(null);
	const save = useAction();
	const boxes = useAction();
	const savedFigures = JSON.stringify(modelFigures(row));
	const [base, setBase] = useState({ text: saved, shown, figures: savedFigures });
	// Live updates (a re-run finishing) replace what is shown only where there are no unsaved changes.
	if (base.text !== saved || base.figures !== savedFigures) {
		if (draft === base.shown) reset();
		if (JSON.stringify(figures) === base.figures) setFigures(modelFigures(row));
		setBase({ text: saved, shown, figures: savedFigures });
	}
	const dirty = draft !== shown;
	const figuresDirty = JSON.stringify(figures) !== savedFigures;

	const changes = useMemo(() => {
		if (row.raw === null || row.proofread === null) return null;
		return diffWords(shownText(row.raw.markdown), shownText(row.proofread.markdown), { intlSegmenter: new Intl.Segmenter("bn", { granularity: "word" }) });
	}, [row.raw, row.proofread]);

	// Selects a suggestion's text in the edit box, so the reader sees where it is.
	const textBox = useRef<HTMLTextAreaElement>(null);
	const showInText = (find: string) => {
		const box = textBox.current;
		if (view !== "edit" || box === null) return setView("edit");
		const at = [find, find.replaceAll("\n\n", "\n")].map((f) => [box.value.indexOf(f), f.length]).find(([i]) => i !== -1);
		if (at === undefined) return;
		box.focus();
		box.setSelectionRange(at[0], at[0] + at[1]);
	};

	const setBox = (index: number, bbox: Figure["bbox"]) => setFigures((list) => list.map((f, i) => (i === index ? { ...f, bbox } : f)));

	return (
		<div className="grid items-start gap-4 lg:grid-cols-2">
			<Card
				title={printed === "" ? `Scan of page ${row.page}` : `Scan of page ${row.page} (printed ${printed})`}
				aside={
					<div className="flex gap-2">
						<Button
							variant="ghost"
							onClick={() => {
								setFigures([...figures, { bbox: [350, 250, 650, 750], caption: "" }]);
								setSelected(figures.length);
							}}
						>
							Add illustration
						</Button>
						{selected !== null && (
							<Button
								variant="ghost"
								onClick={() => {
									setFigures(figures.filter((_, i) => i !== selected));
									setSelected(null);
								}}
							>
								Remove {selected + 1}
							</Button>
						)}
					</div>
				}
			>
				<div className="p-5 pt-8">
					<PageWithBoxes src={urls.pageImage(bookId, row.page)} alt={`Scan of page ${row.page}`} figures={figures} selected={selected} onSelect={setSelected} onChange={setBox} />
				</div>
				{figures.length > 0 && (
					<div className="flex flex-col gap-3 border-t border-rule p-5">
						{figures.map((f, i) => (
							<div key={i} className="flex items-center gap-3">
								<span className="grid h-12 w-12 flex-none place-items-center rounded-sm border border-border text-xs text-faint">
									{figuresDirty ? i + 1 : <img src={urls.figure(bookId, row.page, i, savedFigures)} alt={`Illustration ${i + 1} as cropped`} className="h-full w-full object-contain" />}
								</span>
								<label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-faint">
									Caption {i + 1}
									<input
										value={f.caption}
										className="bangla"
										onChange={(e) => setFigures(figures.map((g, j) => (j === i ? { ...g, caption: e.target.value } : g)))}
									/>
								</label>
							</div>
						))}
					</div>
				)}
				{figuresDirty && (
					<div className="flex items-center justify-end gap-2 border-t border-rule px-5 py-3">
						<ErrorLine>{boxes.error}</ErrorLine>
						<Button onClick={() => setFigures(modelFigures(row))}>Discard</Button>
						<Button variant="primary" disabled={boxes.busy} onClick={() => boxes.run(() => api.put(`/books/${bookId}/pages/${row.page}/figures`, { figures }))}>
							Save illustrations
						</Button>
					</div>
				)}
			</Card>

			<Card
				title={
					<span className="flex items-center gap-2">
						Text <PageStatusPill status={row.status} />
						{row.edited !== null && <span className="text-xs font-normal text-faint">edited by you</span>}
					</span>
				}
				aside={
					(
						<div role="tablist" className="flex rounded-full bg-raised p-0.5">
							{(changes === null ? (["edit", "preview"] as const) : (["edit", "preview", "changes"] as const)).map((v) => (
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
					)
				}
			>
				<div className="flex flex-col gap-3 p-5">
					{row.flag !== null && <p className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-ink">{row.flag}</p>}
					{row.suggestions !== null && (
						<Suggestions bookId={bookId} page={row.page} raw={row.raw?.markdown ?? ""} suggestions={row.suggestions} locked={dirty} show={showInText} saved={refresh} />
					)}
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
						<div
							lang="bn"
							className="bangla page-preview min-h-[60vh] rounded-md border border-border p-3 text-[17px]"
							// markdown-it with raw HTML off escapes the text; only Markdown's own tags come through.
							dangerouslySetInnerHTML={{ __html: renderPage(markdownOf(draft), (i) => urls.figure(bookId, row.page, i, savedFigures)) }}
						/>
					) : (
						<textarea
							ref={textBox}
							aria-label={`Text of page ${row.page} (${compactDraft ? "one line per paragraph" : "Markdown"})`}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							spellCheck={false}
							lang="bn"
							className="bangla min-h-[60vh] resize-y text-[17px]"
						/>
					)}
					<p className="text-xs text-faint">
						Read by {row.engine ?? "—"}. {compactDraft ? "One line per paragraph; a new line starts a new paragraph. " : "Markdown, with a blank line between paragraphs. "}
						<code># Heading</code>, <code>[^1]</code> footnotes, <code>![caption](figure:0)</code> places illustration 1.
					</p>
					<ErrorLine>{save.error}</ErrorLine>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex gap-2">
							<Button variant="ghost" onClick={() => setRerun([row.page])}>
								Read page again
							</Button>
							{batchPages.length > 1 && (
								<Button variant="ghost" onClick={() => setRerun(batchPages)}>
									Read pages {pageRanges(batchPages)} again
								</Button>
							)}
						</div>
						<div className="flex gap-2">
							{row.edited !== null && !dirty && (
								<Button onClick={() => save.run(() => api.put(`/books/${bookId}/pages/${row.page}`, { markdown: null }).then(refresh))}>Use model text</Button>
							)}
							{dirty && <Button onClick={reset}>Discard</Button>}
							<Button variant="primary" disabled={!dirty || save.busy} onClick={() => save.run(() => api.put(`/books/${bookId}/pages/${row.page}`, { markdown: markdownOf(draft) }).then(refresh))}>
								{save.busy ? "Saving…" : "Save"}
							</Button>
						</div>
					</div>
				</div>
			</Card>

			<Confirm
				open={rerun !== null}
				title={rerun?.length === 1 ? `Read page ${row.page} again?` : `Read pages ${pageRanges(rerun ?? [])} again?`}
				action="Read again"
				onConfirm={() => void save.run(() => api.post(`/books/${bookId}/rerun`, { pages: rerun }))}
				onClose={() => setRerun(null)}
			>
				The text {rerun !== null && rerun.length > 1 ? "of these pages" : "of this page"}, your edits to it and your illustration boxes are replaced by a new reading. It counts against the providers' limits like any request.
			</Confirm>
		</div>
	);
}
