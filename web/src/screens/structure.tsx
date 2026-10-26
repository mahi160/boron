import { useState } from "react";
import { api, type Book, type TocEntry, type TocResponse, useLive } from "../api.ts";
import { Button, Card, ErrorLine, useAction } from "../ui.tsx";

const LEVELS = [
	{ value: 1, label: "Chapter" },
	{ value: 2, label: "Section" },
	{ value: 3, label: "Sub-section" },
	{ value: 0, label: "Not a heading (merge)" },
];

const order = (a: TocEntry, b: TocEntry) => a.page - b.page || (a.id.endsWith(":split") ? -1 : b.id.endsWith(":split") ? 1 : a.id.localeCompare(b.id, "en", { numeric: true }));

/** The saved chapter list, plus headings found since it was saved (after a re-run), in reading order. */
function merged(data: TocResponse): TocEntry[] {
	const saved = new Map(data.toc.map((e) => [e.id, e]));
	const extra = data.proposed.filter((e) => !saved.has(e.id));
	return [...data.toc, ...extra].sort(order);
}

export function Structure({ book }: { book: Book }) {
	const { data, error } = useLive<TocResponse>(`/books/${book.id}/toc`, book.id);
	if (data === undefined) return error === null ? <p className="text-faint">Loading chapters…</p> : <ErrorLine>{error}</ErrorLine>;
	return <TocEditor key={JSON.stringify(data.toc)} book={book} data={data} />;
}

function TocEditor({ book, data }: { book: Book; data: TocResponse }) {
	const [entries, setEntries] = useState(() => merged(data));
	const [splitPage, setSplitPage] = useState("");
	const save = useAction();
	const dirty = JSON.stringify(entries) !== JSON.stringify(merged(data));
	const chapters = entries.filter((e) => e.level === 1).length;
	const update = (id: string, patch: Partial<TocEntry>) => setEntries(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));

	function addSplit() {
		const page = Number(splitPage);
		if (!Number.isInteger(page) || page < 1 || page > book.pageCount) return;
		const id = `${page}:split`;
		if (entries.some((e) => e.id === id)) return;
		setEntries([...entries, { id, page, title: "", level: 1 }].sort(order));
		setSplitPage("");
	}

	return (
		<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
			<Card title="Chapters" aside={<span className="text-xs text-faint tabular-nums">{chapters === 0 ? "no chapters yet" : `${chapters} ${chapters === 1 ? "chapter" : "chapters"}`}</span>}>
				{entries.length === 0 ? (
					<p className="px-5 py-4 text-muted">No headings were found on the pages read so far. Add a chapter start below, or mark headings with # on the review screen.</p>
				) : (
					<ol>
						{entries.map((e) => (
							<li key={e.id} className="flex items-center gap-3 border-t border-rule px-5 py-2 first:border-t-0">
								<span className="w-14 flex-none text-xs text-faint tabular-nums">p. {e.page}</span>
								<div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `${Math.max(0, e.level - 1) * 20}px` }}>
									<input
										aria-label={`Title of the heading on page ${e.page}`}
										value={e.title}
										required
										onChange={(event) => update(e.id, { title: event.target.value })}
										className={`bangla min-w-0 flex-1 ${e.level === 0 ? "text-faint line-through" : e.level === 1 ? "font-medium" : ""}`}
									/>
								</div>
								<select aria-label={`Level of the heading on page ${e.page}`} value={e.level} onChange={(event) => update(e.id, { level: Number(event.target.value) })} className="w-48 flex-none">
									{LEVELS.map((l) => (
										<option key={l.value} value={l.value}>
											{l.label}
										</option>
									))}
								</select>
								{e.id.endsWith(":split") ? (
									<Button variant="ghost" aria-label={`Remove the chapter start on page ${e.page}`} onClick={() => setEntries(entries.filter((x) => x.id !== e.id))}>
										Remove
									</Button>
								) : (
									<span className="w-[78px] flex-none" />
								)}
							</li>
						))}
					</ol>
				)}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3">
					<ErrorLine>{save.error}</ErrorLine>
					{data.edited && !dirty && (
						<Button onClick={() => save.run(() => api.put(`/books/${book.id}/toc`, { toc: null }))}>Use the headings as read</Button>
					)}
					<div className="ml-auto flex gap-2">
						{dirty && <Button onClick={() => setEntries(merged(data))}>Discard</Button>}
						<Button variant="primary" disabled={!dirty || save.busy || entries.some((e) => e.title.trim() === "")} onClick={() => save.run(() => api.put(`/books/${book.id}/toc`, { toc: entries }))}>
							Save chapters
						</Button>
					</div>
				</div>
			</Card>

			<Card title="Split a chapter">
				<div className="flex flex-col gap-3 p-5">
					<p className="text-muted">Start a new chapter at the top of a page that has no heading of its own.</p>
					<div className="flex gap-2">
						<input
							type="number"
							min={1}
							max={book.pageCount}
							placeholder="Page"
							aria-label="Page to start a chapter on"
							value={splitPage}
							onChange={(e) => setSplitPage(e.target.value)}
							className="w-24 tabular-nums"
						/>
						<Button onClick={addSplit}>Add chapter start</Button>
					</div>
					<p className="text-xs text-faint">To merge a chapter into the one before it, set its heading to “Not a heading”.</p>
				</div>
			</Card>
		</div>
	);
}
