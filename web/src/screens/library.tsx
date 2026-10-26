import { useRef, useState } from "react";
import { api, type LibraryBook, urls, useLive } from "../api.ts";
import { clock, count, until } from "../format.ts";
import { href } from "../router.ts";
import { BookStatus, isActive } from "../status.tsx";
import { Button, Confirm, ErrorLine, Progress, useAction, useNow } from "../ui.tsx";

type Range = { all: boolean; from: string; to: string };
const ALL_PAGES: Range = { all: true, from: "1", to: "" };

/** The line under the title: what is happening across the library right now. */
function summary(books: LibraryBook[], now: number): string {
	if (books.length === 0) return "Add a scanned Bangla PDF to turn it into a proofread EPUB.";
	const reading = books.filter((b) => isActive(b.status));
	const waits = books.flatMap((b) => (b.nextWake !== null && b.nextWake > now ? [b.nextWake] : []));
	const ready = books.filter((b) => b.status === "ready").length;
	const parts = [`${count(books.length)} ${books.length === 1 ? "book" : "books"}`];
	if (reading.length > 0) parts.push(`${reading.length} reading`);
	if (waits.length > 0) parts.push(`waiting for quota until ${clock(Math.min(...waits))}`);
	if (ready > 0) parts.push(`${ready} ready to download`);
	return parts.join(" · ");
}

export function Library() {
	const { data: all, error } = useLive<LibraryBook[]>("/books", "*");
	// Translation books are listed on the Translate screen.
	const books = all?.filter((b) => b.kind === "pdf-ocr");
	const upload = useAction();
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const now = useNow();
	// Chosen PDFs wait here until the user confirms or skips each one in the dialog.
	const [queue, setQueue] = useState<{ id: number; file: File }[]>([]);
	const nextId = useRef(0);
	const [range, setRange] = useState<Range>(ALL_PAGES);
	const current = queue[0];

	function add(files: FileList | null) {
		const pdfs = [...(files ?? [])].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
		if (pdfs.length > 0) setQueue((q) => [...q, ...pdfs.map((file) => ({ id: nextId.current++, file }))]);
	}

	function send(file: File, chosen: Range) {
		void upload.run(async () => {
			const form = new FormData();
			form.append("file", file);
			if (!chosen.all) {
				form.append("from", chosen.from);
				form.append("to", chosen.to);
			}
			await api.post("/books", form);
		});
	}

	return (
		<div
			className="flex flex-col gap-6"
			onDragOver={(e) => {
				e.preventDefault();
				setDragging(true);
			}}
			onDragLeave={(e) => {
				if (e.currentTarget === e.target) setDragging(false);
			}}
			onDrop={(e) => {
				e.preventDefault();
				setDragging(false);
				void add(e.dataTransfer.files);
			}}
		>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Library</h1>
					<p className="mt-1 text-muted">{books === undefined ? "Loading…" : summary(books, now)}</p>
				</div>
				<input
					ref={input}
					type="file"
					accept="application/pdf,.pdf"
					multiple
					hidden
					onChange={(e) => {
						add(e.target.files);
						e.target.value = "";
					}}
				/>
				<Button variant="primary" disabled={upload.busy} onClick={() => input.current?.click()}>
					{upload.busy ? "Uploading…" : "Add PDF"}
				</Button>
			</div>
			<ErrorLine>{upload.error ?? error}</ErrorLine>

			<Confirm
				// A fresh dialog per file, so it opens again after Escape closed the previous one.
				key={current?.id ?? -1}
				open={current !== undefined}
				title={`Add ${current?.file.name ?? "PDF"}?`}
				action={range.all ? "Read all pages" : "Read these pages"}
				onConfirm={() => current !== undefined && send(current.file, range)}
				onClose={() => {
					// Called again by the dialog's own close event; removing this file twice is harmless.
					setQueue((q) => q.filter((item) => item.id !== current?.id));
					setRange(ALL_PAGES);
				}}
			>
				<fieldset className="flex flex-col gap-3">
					<legend className="sr-only">Pages to read</legend>
					<label className="flex items-center gap-2 text-ink">
						<input type="radio" name="range" checked={range.all} onChange={() => setRange({ ...range, all: true })} />
						All pages
					</label>
					<label className="flex items-center gap-2 text-ink">
						<input type="radio" name="range" checked={!range.all} onChange={() => setRange({ ...range, all: false })} />
						Only pages
					</label>
					<div className="flex items-center gap-2 pl-6">
						<input
							type="number"
							min={1}
							aria-label="First page"
							value={range.from}
							onChange={(e) => setRange({ ...range, all: false, from: e.target.value })}
							className="w-20 tabular-nums"
						/>
						to
						<input
							type="number"
							min={1}
							aria-label="Last page"
							placeholder="end"
							value={range.to}
							onChange={(e) => setRange({ ...range, all: false, to: e.target.value })}
							className="w-20 tabular-nums"
						/>
					</div>
					<p className="text-xs text-faint">
						Pages as numbered in the PDF file, from 1. For example 1 to 10 reads the first ten pages, a cheap way to try a provider before reading a whole book.
						{queue.length > 1 && ` ${queue.length - 1} more ${queue.length === 2 ? "PDF" : "PDFs"} after this one.`}
					</p>
				</fieldset>
			</Confirm>

			{books !== undefined && books.length === 0 ? (
				<button
					type="button"
					onClick={() => input.current?.click()}
					className={`grid h-56 place-items-center rounded-lg border border-dashed text-muted transition-colors ${dragging ? "border-ink bg-raised" : "border-control"}`}
				>
					<span>
						Drop a PDF here, or <span className="text-ink underline underline-offset-2">choose a file</span>.
						<br />
						Pages are read as images, so the scan's own text layer does not matter.
					</span>
				</button>
			) : (
				<div className={`overflow-x-auto rounded-lg border bg-surface ${dragging ? "border-ink" : "border-border"}`}>
					<table className="w-full min-w-[720px] text-left tabular-nums">
						<thead className="text-xs text-faint">
							<tr className="h-10">
								<th className="w-[40%] pl-5 font-normal">Book</th>
								<th className="font-normal">Status</th>
								<th className="w-[24%] font-normal">Pages read</th>
								<th className="pr-5 text-right font-normal">Tokens</th>
								<th className="pr-5 text-right font-normal">
									<span className="sr-only">Download</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{books === undefined && (
								<tr>
									<td colSpan={5} className="h-16 pl-5 text-faint">
										Loading books…
									</td>
								</tr>
							)}
							{books?.map((book) => (
								<BookRow key={book.id} book={book} now={now} />
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

export function BookRow({ book, now }: { book: LibraryBook; now: number }) {
	const read = book.done + book.flagged;
	const hasCover = book.kind === "epub-translate" ? book.cover.kind !== "none" : book.rendered > 0;
	const link = href({ screen: "book", id: book.id, tab: "job", page: 1 });
	const waiting = book.nextWake !== null && book.nextWake > now && isActive(book.status);
	return (
		<tr className="h-[72px] border-t border-rule hover:bg-raised/60">
			<td className="pl-5">
				<a href={link} className="flex items-center gap-3">
					<span className="h-12 w-9 flex-none overflow-hidden rounded-sm border border-border bg-raised">
						{hasCover && <img src={urls.cover(book.id, `${book.rendered}`)} alt="" loading="lazy" className="h-full w-full object-cover" />}
					</span>
					<span className="min-w-0">
						<span className="bangla block truncate text-[15px] font-medium leading-6">{book.title}</span>
						<span className="block truncate text-xs text-faint">{book.author === "" ? book.fileName : <span className="bangla">{book.author}</span>}</span>
					</span>
				</a>
			</td>
			<td>
				<div className="flex flex-col items-start gap-1">
					<BookStatus status={book.status} />
					{waiting && book.nextWake !== null && <span className="text-xs text-faint">resumes {until(book.nextWake, now)}</span>}
				</div>
			</td>
			<td className="pr-6">
				<div className="flex flex-col gap-1.5">
					<span>
						{count(read)}
						<span className="text-faint"> / {count(book.pageCount)}</span>
						{book.flagged > 0 && <span className="text-faint"> · {book.flagged} to check</span>}
						{book.failed > 0 && <span className="text-neg-ink"> · {book.failed} failed</span>}
					</span>
					<Progress value={read} total={book.pageCount} label={`${book.title}: ${book.kind === "epub-translate" ? "chunks translated" : "pages read"}`} />
				</div>
			</td>
			<td className="pr-5 text-right">
				{book.inputTokens + book.outputTokens === 0 ? <span className="text-faint">—</span> : count(book.inputTokens + book.outputTokens)}
			</td>
			<td className="pr-5 text-right">
				{read > 0 ? (
					<a href={urls.epub(book.id)} className="text-sm font-medium underline-offset-2 hover:underline">
						EPUB
					</a>
				) : (
					<span className="text-faint">—</span>
				)}
			</td>
		</tr>
	);
}
