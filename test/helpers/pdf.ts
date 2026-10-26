/** A minimal valid PDF whose pages are blank except for one black square, for render tests. */
export function makePdf(pageCount: number): Uint8Array {
	const pageIds = Array.from({ length: pageCount }, (_, i) => 3 + i * 2);
	const objects: string[] = [
		"<</Type/Catalog/Pages 2 0 R>>",
		`<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(" ")}]/Count ${pageCount}>>`,
	];
	const content = "0 0 0 rg 50 50 100 100 re f";
	for (const id of pageIds) {
		objects.push(
			`<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 300]/Contents ${id + 1} 0 R/Resources<<>>>>`,
			`<</Length ${content.length}>>\nstream\n${content}\nendstream`,
		);
	}
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}
