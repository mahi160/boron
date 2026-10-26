// Starts one OCR task on SQLite whose model request never answers; prints REQUEST when the request is in flight.
// The test SIGKILLs this process there, then resumes the task in its own process.
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { openHarness } from "../../src/harness.ts";
import { fauxModels, startOcr } from "../helpers/ocr.ts";

const [dbPath, pdfPath] = process.argv.slice(2);
if (dbPath === undefined || pdfPath === undefined) throw new Error("usage: crash-run.ts <db> <pdf>");
const { models, ref } = fauxModels(() => {
	process.stdout.write("REQUEST\n");
	return new Promise(() => {});
});
const harness = await openHarness(await openNodeSqliteStorage(dbPath), models);
await startOcr(harness, { pdfPath, page: 1, model: ref });
harness.resume();
