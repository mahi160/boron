import type { ReactNode } from "react";
import { type CostByBook, type CostByModel, type CostByStage, type LibraryBook, useLive } from "../api.ts";
import { count, usd } from "../format.ts";
import { href } from "../router.ts";
import { Card, ErrorLine } from "../ui.tsx";

type Totals = { requests: number; inputTokens: number; outputTokens: number; cost: number };

const sum = (rows: Totals[]): Totals =>
	rows.reduce(
		(t, r) => ({ requests: t.requests + r.requests, inputTokens: t.inputTokens + r.inputTokens, outputTokens: t.outputTokens + r.outputTokens, cost: t.cost + r.cost }),
		{ requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
	);

const STAGES: Record<string, string> = { ocr: "OCR", proofread: "Proofread", assemble: "Title page" };

const PRICE_NOTE = "Costs use each provider's price when the request was made: its price in Settings, else the catalog price for the model. Set 0 for a free tier.";

/** A table of cost rows: a label cell, then requests, tokens in and out, and cost, with a total row. */
function CostTable<T extends Totals>({ rows, head, label, empty }: { rows: T[]; head: string; label: (row: T) => ReactNode; empty: string }) {
	const total = sum(rows);
	const cells = (t: Totals) => (
		<>
			<td className="text-right">{count(t.requests)}</td>
			<td className="text-right">{count(t.inputTokens)}</td>
			<td className="text-right">{count(t.outputTokens)}</td>
			<td className="pr-5 text-right font-medium">{usd(t.cost)}</td>
		</>
	);
	if (rows.length === 0) return <p className="p-5 text-faint">{empty}</p>;
	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[600px] text-left tabular-nums">
				<thead className="text-xs text-faint">
					<tr className="h-10">
						<th className="pl-5 font-normal">{head}</th>
						<th className="text-right font-normal">Requests</th>
						<th className="text-right font-normal">Tokens in</th>
						<th className="text-right font-normal">Tokens out</th>
						<th className="pr-5 text-right font-normal">Cost</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className="h-11 border-t border-rule">
							<td className="pl-5">{label(row)}</td>
							{cells(row)}
						</tr>
					))}
					<tr className="h-11 border-t border-border font-medium">
						<td className="pl-5">Total</td>
						{cells(total)}
					</tr>
				</tbody>
			</table>
		</div>
	);
}

const model = (row: CostByModel) => (
	<span>
		{row.provider} <span className="text-faint">· {row.model}</span>
	</span>
);

/** One book's costs per provider, model and stage, with the cost per page read so far. */
export function BookCosts({ book }: { book: LibraryBook }) {
	const { data, error } = useLive<CostByStage[]>(`/books/${book.id}/costs`, book.id);
	if (data === undefined) return error === null ? <p className="text-faint">Loading…</p> : <ErrorLine>{error}</ErrorLine>;
	const total = sum(data);
	const read = book.done + book.flagged;
	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted">
				<span className="text-2xl font-semibold text-ink tabular-nums">{usd(total.cost)}</span>
				{read > 0 && total.cost > 0 && <span className="tabular-nums"> · about {usd(total.cost / read)} per page read</span>}
			</p>
			<Card>
				<CostTable rows={data} head="Provider · stage" label={(row) => <span>{model(row)} <span className="text-faint">· {STAGES[row.stage] ?? row.stage}</span></span>} empty="No model requests yet. Tesseract pages cost nothing." />
			</Card>
			<p className="text-xs text-faint">{PRICE_NOTE}</p>
		</div>
	);
}

/** Costs across the library, deleted books included. */
export function CostsScreen() {
	const { data, error } = useLive<{ byBook: CostByBook[]; byModel: CostByModel[] }>("/costs", "*");
	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Costs</h1>
				<p className="mt-1 text-muted">{data === undefined ? "Loading…" : <span className="tabular-nums">{usd(sum(data.byModel).cost)} in total</span>}</p>
			</div>
			<ErrorLine>{error}</ErrorLine>
			{data !== undefined && (
				<>
					<Card title="By provider">
						<CostTable rows={data.byModel} head="Provider · model" label={model} empty="No model requests yet." />
					</Card>
					<Card title="By book">
						<CostTable
							rows={data.byBook}
							head="Book"
							label={(row) =>
								row.deleted ? (
									<span className="bangla text-faint">{row.title} (deleted)</span>
								) : (
									<a href={href({ screen: "book", id: row.bookId, tab: "costs", page: 1 })} className="bangla underline-offset-2 hover:underline">
										{row.title}
									</a>
								)
							}
							empty="No model requests yet."
						/>
					</Card>
					<p className="text-xs text-faint">{PRICE_NOTE}</p>
				</>
			)}
		</div>
	);
}
