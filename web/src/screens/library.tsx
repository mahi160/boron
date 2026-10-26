import { useRef, useState } from "react";
import { api, type LibraryBook, urls, useLive } from "../api.ts";
import { clock, count, until } from "../format.ts";
import { href } from "../router.ts";
import { BookStatus, isActive } from "../status.tsx";
import { Button, ErrorLine, Progress, useAction, useNow } from "../ui.tsx";

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
	const { data: books, error } = useLive<LibraryBook[]>("/books", "*");
	const upload = useAction();
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const now = useNow();

	async function add(files: FileList | null) {
		const pdfs = [...(files ?? [])].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
		if (pdfs.length === 0) return;
		await upload.run(async () => {
			for (const file of pdfs) {
				const form = new FormData();
				form.append("file", file);
				await api.post("/books", form);
			}
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
				<input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
				<Button variant="primary" disabled={upload.busy} onClick={() => input.current?.click()}>
					{upload.busy ? "Uploading…" : "Add PDF"}
				</Button>
			</div>
			<ErrorLine>{upload.error ?? error}</ErrorLine>

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

function BookRow({ book, now }: { book: LibraryBook; now: number }) {
	const read = book.done + book.flagged;
	const link = href({ screen: "book", id: book.id, tab: "job", page: 1 });
	const waiting = book.nextWake !== null && book.nextWake > now && isActive(book.status);
	return (
		<tr className="h-[72px] border-t border-rule hover:bg-raised/60">
			<td className="pl-5">
				<a href={link} className="flex items-center gap-3">
					<span className="h-12 w-9 flex-none overflow-hidden rounded-sm border border-border bg-raised">
						{book.rendered > 0 && <img src={urls.cover(book.id, `${book.rendered}`)} alt="" loading="lazy" className="h-full w-full object-cover" />}
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
					<Progress value={read} total={book.pageCount} label={`${book.title}: pages read`} />
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
