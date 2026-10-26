import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Hono } from "hono";
import { createApi } from "./api.ts";
import { createBoron } from "./boron.ts";
import { DATA_DIR, PORT, paths } from "./config.ts";
import { modelsFor } from "./models.ts";
import { createTesseract } from "./pipeline/tesseract.ts";
import { getSettings } from "./settings.ts";
import { openStore } from "./store.ts";

const store = openStore(paths.appDb);
const boron = await createBoron({
	storage: await openNodeSqliteStorage(paths.durableDb),
	store,
	settings: getSettings,
	models: modelsFor,
	tesseract: createTesseract(paths.tessdata),
	booksDir: paths.books,
});

const app = new Hono();
app.route("/api", createApi(boron, store));
const web = join(import.meta.dirname, "..", "dist", "web");
if (existsSync(web)) {
	app.use("/*", serveStatic({ root: web }));
	// The SPA routes in the browser; every other path gets its shell.
	app.get("*", serveStatic({ root: web, path: "index.html" }));
}

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`Boron is running at http://localhost:${info.port} (data in ${DATA_DIR})`);
});

let closing = false;
async function shutdown() {
	if (closing) return;
	closing = true;
	server.close();
	await boron.close();
	store.close();
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
