import { useRef, useState } from "react";
import { api, type Book, urls } from "../api.ts";
import { Button, Card, ErrorLine, Field, useAction } from "../ui.tsx";

const FIELDS = [
	{ key: "title", label: "Title", bangla: true },
	{ key: "author", label: "Author", bangla: true },
	{ key: "publisher", label: "Publisher", bangla: true },
	{ key: "year", label: "Year", bangla: false },
] as const;

export function Details({ book, reload }: { book: Book; reload: () => Promise<void> }) {
	const [meta, setMeta] = useState({ title: book.title, author: book.author, publisher: book.publisher, year: book.year });
	const [coverPage, setCoverPage] = useState(book.cover.kind === "page" ? String(book.cover.page) : "1");
	const save = useAction();
	const cover = useAction();
	const file = useRef<HTMLInputElement>(null);
	const dirty = FIELDS.some((f) => meta[f.key] !== book[f.key]);
	const coverVersion = JSON.stringify(book.cover) + book.rendered;

	return (
		<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
			<Card title="Book details">
				<form
					className="flex flex-col gap-4 p-5"
					onSubmit={(e) => {
						e.preventDefault();
						void save.run(() => api.put(`/books/${book.id}/meta`, { ...meta, cover: book.cover }).then(reload));
					}}
				>
					<p className="text-muted">Filled in from the title page when the book was read; they go into the EPUB as you save them.</p>
					{FIELDS.map((f) => (
						<Field key={f.key} label={f.label}>
							{(id) => (
								<input
									id={id}
									value={meta[f.key]}
									required={f.key === "title"}
									className={f.bangla ? "bangla" : "tabular-nums"}
									onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })}
								/>
							)}
						</Field>
					))}
					<p className="text-xs text-faint">Language: Bangla (bn) · Source file: {book.fileName}</p>
					<ErrorLine>{save.error}</ErrorLine>
					<div className="flex justify-end">
						<Button type="submit" variant="primary" disabled={!dirty || save.busy}>
							Save details
						</Button>
					</div>
				</form>
			</Card>

			<Card title="Cover">
				<div className="flex flex-col gap-4 p-5">
					<img src={urls.cover(book.id, coverVersion)} alt={`Cover of ${book.title}`} className="aspect-[2/3] w-full rounded-sm border border-border bg-raised object-cover" />
					<p className="text-xs text-faint">{book.cover.kind === "upload" ? "Your uploaded image." : `Page ${book.cover.page} of the scan.`}</p>
					<div className="flex gap-2">
						<input
							type="number"
							min={1}
							max={book.pageCount}
							aria-label="Page to use as the cover"
							value={coverPage}
							onChange={(e) => setCoverPage(e.target.value)}
							className="w-24 tabular-nums"
						/>
						<Button
							disabled={cover.busy}
							onClick={() => cover.run(() => api.put(`/books/${book.id}/meta`, { ...book, cover: { kind: "page", page: Number(coverPage) } }).then(reload))}
						>
							Use this page
						</Button>
					</div>
					<input
						ref={file}
						type="file"
						accept="image/jpeg,image/png"
						hidden
						onChange={(e) => {
							const picked = e.target.files?.[0];
							if (picked === undefined) return;
							const form = new FormData();
							form.append("file", picked);
							void cover.run(() => api.post(`/books/${book.id}/cover`, form).then(reload));
							e.target.value = "";
						}}
					/>
					<Button onClick={() => file.current?.click()} disabled={cover.busy}>
						Upload an image
					</Button>
					<ErrorLine>{cover.error}</ErrorLine>
				</div>
			</Card>
		</div>
	);
}
