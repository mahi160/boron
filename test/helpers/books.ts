import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "./pdf.ts";

export async function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "boron-test-"));
}

export async function samplePdf(dir: string, pages = 3): Promise<string> {
	const path = join(dir, "book.pdf");
	await writeFile(path, makePdf(pages));
	return path;
}
