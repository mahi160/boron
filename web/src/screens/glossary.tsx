import { useState } from "react";
import { api, type Book, type GlossaryEntry, useLive } from "../api.ts";
import { Button, Card, ErrorLine, useAction } from "../ui.tsx";

/** "1-3, 5" → [1, 2, 3, 5]; null if it is not a list of chunk numbers within the book. */
function parseChunks(text: string, max: number): number[] | null {
	const chunks = new Set<number>();
	for (const part of text.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
		const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
		if (m === null) return null;
		const from = Number(m[1]);
		const to = Number(m[2] ?? m[1]);
		if (from < 1 || to > max || to < from) return null;
		for (let n = from; n <= to; n++) chunks.add(n);
	}
	return chunks.size === 0 ? null : [...chunks];
}

/** The names and terms every chunk is translated with: editable, then selected chunks can be translated again. */
export function Glossary({ book }: { book: Book }) {
	const { data, error } = useLive<{ glossary: GlossaryEntry[] | null }>(`/books/${book.id}/glossary`, book.id);
	if (data === undefined) return error === null ? <p className="text-faint">Loading…</p> : <ErrorLine>{error}</ErrorLine>;
	return <GlossaryEditor key={JSON.stringify(data.glossary)} book={book} saved={data.glossary} />;
}

function GlossaryEditor({ book, saved }: { book: Book; saved: GlossaryEntry[] | null }) {
	const [rows, setRows] = useState<GlossaryEntry[]>(saved ?? []);
	const [chunks, setChunks] = useState("");
	const save = useAction();
	const rerun = useAction();
	const dirty = JSON.stringify(rows) !== JSON.stringify(saved ?? []);
	const set = (i: number, patch: Partial<GlossaryEntry>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	const picked = parseChunks(chunks, book.pageCount);

	return (
		<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
			<Card title="Glossary" aside={<span className="text-xs text-faint tabular-nums">{rows.length} entries</span>}>
				<div className="flex flex-col gap-3 p-5">
					<p className="text-muted">
						{saved === null
							? "Made from the whole book before the first chunk is translated. You can also write it yourself."
							: "Every translate and polish request uses these Bangla forms, so names stay the same throughout the book."}
					</p>
					{rows.length > 0 && (
						<table className="w-full text-left">
							<thead className="text-xs text-faint">
								<tr>
									<th className="pb-1 font-normal">English</th>
									<th className="pb-1 font-normal">Bangla</th>
									<th>
										<span className="sr-only">Remove</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r, i) => (
									<tr key={i}>
										<td className="py-1 pr-2">
											<input aria-label={`English ${i + 1}`} value={r.en} onChange={(e) => set(i, { en: e.target.value })} className="w-full" />
										</td>
										<td className="py-1 pr-2">
											<input aria-label={`Bangla ${i + 1}`} lang="bn" value={r.bn} onChange={(e) => set(i, { bn: e.target.value })} className="bangla w-full" />
										</td>
										<td className="py-1 text-right">
											<Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
												Remove
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					<ErrorLine>{save.error}</ErrorLine>
					<div className="flex justify-between gap-2">
						<Button onClick={() => setRows([...rows, { en: "", bn: "" }])}>Add entry</Button>
						<div className="flex gap-2">
							<Button disabled={!dirty || save.busy} onClick={() => setRows(saved ?? [])}>
								Discard
							</Button>
							<Button variant="primary" disabled={!dirty || save.busy} onClick={() => save.run(() => api.put(`/books/${book.id}/glossary`, { glossary: rows }))}>
								Save glossary
							</Button>
						</div>
					</div>
				</div>
			</Card>

			<Card title="Translate again">
				<form
					className="flex flex-col gap-3 p-5"
					onSubmit={(e) => {
						e.preventDefault();
						if (picked !== null) void rerun.run(() => api.post(`/books/${book.id}/rerun`, { pages: picked }).then(() => setChunks("")));
					}}
				>
					<p className="text-muted">After changing the glossary, translate the chunks that use the changed names again. Your edits of those chunks are replaced.</p>
					<label className="flex flex-col gap-1.5 text-sm font-medium">
						Chunks
						<input value={chunks} onChange={(e) => setChunks(e.target.value)} placeholder={`e.g. 1-3, 5 (of ${book.pageCount})`} className="font-normal tabular-nums" />
					</label>
					<ErrorLine>{rerun.error ?? (chunks.trim() !== "" && picked === null ? `Use chunk numbers from 1 to ${book.pageCount}, like 1-3, 5.` : null)}</ErrorLine>
					<Button type="submit" disabled={picked === null || dirty || rerun.busy}>
						Translate {picked === null ? "" : `${picked.length} `}again
					</Button>
					{dirty && <p className="text-xs text-faint">Save the glossary first.</p>}
				</form>
			</Card>
		</div>
	);
}
