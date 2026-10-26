import { api, type BatchRow, type BookDetail, type PageSummary } from "../api.ts";
import { count, pageRanges, until } from "../format.ts";
import { href } from "../router.ts";
import { BatchState } from "../status.tsx";
import { Button, Card, ErrorLine, useAction, useNow } from "../ui.tsx";

const CELL: Record<PageSummary["status"], string> = {
	pending: "bg-raised",
	done: "bg-data",
	flagged: "bg-[#e8b04b]",
	failed: "bg-negative",
};

const OPEN: BatchRow["state"][] = ["running", "retrying", "waiting", "queued"];

export function Job({ detail, reload }: { detail: BookDetail; reload: () => Promise<void> }) {
	const { book, pages, batches, parked, exhausted } = detail;
	const now = useNow();
	const retry = useAction();
	const open = batches.filter((b) => OPEN.includes(b.state));
	const closed = batches.filter((b) => !OPEN.includes(b.state)).slice(-8).reverse();
	const statusCount = (s: PageSummary["status"]) => pages.filter((p) => p.status === s).length;
	const rendering = book.status === "rendering";

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
			<div className="flex min-w-0 flex-col gap-4">
				<Card
					title="Pages"
					aside={
						<span className="text-xs text-faint tabular-nums">
							{rendering ? `rendering ${count(book.rendered)} / ${count(book.pageCount)}` : `${count(book.pageCount)} pages`}
						</span>
					}
				>
					<div className="flex flex-col gap-4 p-5">
						{/* One cell per page: the book's state at a glance; click a page to review it. */}
						<div className="grid grid-cols-[repeat(auto-fill,minmax(14px,1fr))] gap-[3px]">
							{pages.map((p) => (
								<a
									key={p.page}
									href={href({ screen: "book", id: book.id, tab: "review", page: p.page })}
									title={`Page ${p.page}: ${p.status}${p.flag ? ` — ${p.flag}` : ""}`}
									aria-label={`Page ${p.page}, ${p.status}`}
									className={`aspect-[3/4] rounded-[2px] hover:outline hover:outline-1 hover:outline-ink ${CELL[p.status]}`}
								/>
							))}
							{pages.length === 0 && <span className="col-span-full text-faint">Counting pages…</span>}
						</div>
						<ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted tabular-nums">
							<Legend className={CELL.done} label="Read" value={statusCount("done")} />
							<Legend className={CELL.flagged} label="To check" value={statusCount("flagged")} />
							<Legend className={CELL.failed} label="Failed" value={statusCount("failed")} />
							<Legend className={`${CELL.pending} border border-control`} label="Not read yet" value={statusCount("pending")} />
						</ul>
					</div>
				</Card>

				<Card title="Requests" aside={<span className="text-xs text-faint">{open.length === 0 ? "none in progress" : `${open.length} in progress`}</span>}>
					{batches.length === 0 ? (
						<p className="px-5 py-4 text-faint">{rendering ? "Requests start once every page is rendered." : "No requests yet."}</p>
					) : (
						<table className="w-full text-left tabular-nums">
							<thead className="text-xs text-faint">
								<tr className="h-9">
									<th className="pl-5 font-normal">Pages</th>
									<th className="font-normal">State</th>
									<th className="font-normal">Provider</th>
									<th className="pr-5 text-right font-normal">Tokens in / out</th>
								</tr>
							</thead>
							<tbody>
								{[...open, ...closed].map((b) => (
									<tr key={b.id} className="border-t border-rule align-top">
										<td className="py-2.5 pl-5">
											{b.job === "metadata" ? "Title page" : pageRanges(b.pages)}
											{b.stage !== null && b.job === "pages" && <span className="text-faint"> · {b.stage === "ocr" ? "OCR" : "Proofread"}</span>}
										</td>
										<td className="py-2.5">
											<BatchState state={b.state} />
											{(b.note !== null || b.wakeAt !== null) && (
												<p className="mt-1 max-w-[46ch] text-xs text-faint">
													{b.note}
													{b.wakeAt !== null && b.wakeAt > now && ` · again ${until(b.wakeAt, now)}`}
												</p>
											)}
										</td>
										<td className="py-2.5 text-muted">{b.provider ?? "—"}</td>
										<td className="py-2.5 pr-5 text-right">
											{b.inputTokens + b.outputTokens === 0 ? (
												<span className="text-faint">—</span>
											) : (
												<>
													{count(b.inputTokens)}
													<span className="text-faint"> / {count(b.outputTokens)}</span>
												</>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</Card>
			</div>

			<div className="flex flex-col gap-4">
				<Card title="Usage">
					<dl className="grid grid-cols-2 divide-x divide-rule tabular-nums">
						<div className="px-5 py-4">
							<dt className="text-xs text-faint">Tokens in</dt>
							<dd className="mt-1 text-xl">{count(book.inputTokens)}</dd>
						</div>
						<div className="px-5 py-4">
							<dt className="text-xs text-faint">Tokens out</dt>
							<dd className="mt-1 text-xl">{count(book.outputTokens)}</dd>
						</div>
					</dl>
				</Card>

				<Card title="Providers">
					{exhausted.length === 0 ? (
						<p className="px-5 py-4 text-muted">Every provider has quota left today.</p>
					) : (
						<ul>
							{exhausted.map((e) => (
								<li key={e.provider} className="flex items-center justify-between gap-3 border-t border-rule px-5 py-3 first:border-t-0">
									<span>{e.name}</span>
									<span className="text-xs text-faint tabular-nums">out of quota · resets {until(e.until, now)}</span>
								</li>
							))}
						</ul>
					)}
				</Card>

				{parked.length > 0 && (
					<Card title="Parked">
						<p className="px-5 pt-3 text-xs text-muted">These requests crashed the server more than once and were set aside.</p>
						<ul className="p-2">
							{parked.map((p) => {
								const batch = batches.find((b) => b.id === p.batchId);
								return (
									<li key={p.taskId} className="flex items-center justify-between gap-3 rounded-md px-3 py-2">
										<span className="min-w-0">
											<span className="block">{batch === undefined ? "Book job" : `Pages ${pageRanges(batch.pages)}`}</span>
											<span className="block truncate text-xs text-faint">{p.reason}</span>
										</span>
										<Button disabled={retry.busy} onClick={() => retry.run(() => api.post(`/parked/${p.taskId}/retry`).then(reload))}>
											Retry
										</Button>
									</li>
								);
							})}
						</ul>
						<div className="px-5 pb-3">
							<ErrorLine>{retry.error}</ErrorLine>
						</div>
					</Card>
				)}
			</div>
		</div>
	);
}

function Legend({ className, label, value }: { className: string; label: string; value: number }) {
	return (
		<li className="flex items-center gap-1.5">
			<span aria-hidden className={`inline-block h-2.5 w-2 rounded-[2px] ${className}`} />
			{label} <span className="text-ink">{count(value)}</span>
		</li>
	);
}
