import { useRef, useState } from "react";
import { api, type LibraryBook, useLive } from "../api.ts";
import { clock, count } from "../format.ts";
import { go } from "../router.ts";
import { isActive } from "../status.tsx";
import { Button, ErrorLine, useAction, useNow } from "../ui.tsx";
import { BookRow } from "./library.tsx";

function summary(books: LibraryBook[], now: number): string {
	if (books.length === 0) return "Add an English EPUB to translate it into a Bangla EPUB.";
	const working = books.filter((b) => isActive(b.status)).length;
	const waits = books.flatMap((b) => (b.nextWake !== null && b.nextWake > now ? [b.nextWake] : []));
	const ready = books.filter((b) => b.status === "ready").length;
	const parts = [`${count(books.length)} ${books.length === 1 ? "book" : "books"}`];
	if (working > 0) parts.push(`${working} translating`);
	if (waits.length > 0) parts.push(`waiting for quota until ${clock(Math.min(...waits))}`);
	if (ready > 0) parts.push(`${ready} ready to download`);
	return parts.join(" · ");
}

/** English EPUBs being translated to Bangla: upload and list. */
export function TranslateLibrary() {
	const { data: all, error } = useLive<LibraryBook[]>("/books", "*");
	const books = all?.filter((b) => b.kind === "epub-translate");
	const upload = useAction();
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const now = useNow();

	function send(files: FileList | null) {
		const file = [...(files ?? [])].find((f) => f.name.toLowerCase().endsWith(".epub"));
		if (file === undefined) return;
		void upload.run(async () => {
			const form = new FormData();
			form.append("file", file);
			const { id } = await api.post<{ id: string }>("/translate", form);
			go({ screen: "book", id, tab: "job", page: 1 });
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
				send(e.dataTransfer.files);
			}}
		>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Translate</h1>
					<p className="mt-1 text-muted">{books === undefined ? "Loading…" : summary(books, now)}</p>
				</div>
				<input
					ref={input}
					type="file"
					accept="application/epub+zip,.epub"
					hidden
					onChange={(e) => {
						send(e.target.files);
						e.target.value = "";
					}}
				/>
				<Button variant="primary" disabled={upload.busy} onClick={() => input.current?.click()}>
					{upload.busy ? "Uploading…" : "Add EPUB"}
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
						Drop an English EPUB here, or <span className="text-ink underline underline-offset-2">choose a file</span>.
						<br />
						It is translated chunk by chunk into modern standard Bangla, keeping headings, emphasis and images.
					</span>
				</button>
			) : (
				<div className={`overflow-x-auto rounded-lg border bg-surface ${dragging ? "border-ink" : "border-border"}`}>
					<table className="w-full min-w-[720px] text-left tabular-nums">
						<thead className="text-xs text-faint">
							<tr className="h-10">
								<th className="w-[40%] pl-5 font-normal">Book</th>
								<th className="font-normal">Status</th>
								<th className="w-[24%] font-normal">Chunks translated</th>
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
