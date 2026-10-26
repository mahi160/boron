import { join, resolve } from "node:path";

/** Everything Boron stores lives under one directory (`/data` in Docker). */
export const DATA_DIR = resolve(process.env.BORON_DATA_DIR ?? "data");

export const paths = {
	appDb: join(DATA_DIR, "boron.db"),
	durableDb: join(DATA_DIR, "durable.sqlite"),
	settings: join(DATA_DIR, "settings.json"),
	// The Docker image ships the Bangla model outside the data volume.
	tessdata: process.env.BORON_TESSDATA ?? join(DATA_DIR, "tessdata"),
	books: join(DATA_DIR, "books"),
};

export const PORT = Number(process.env.PORT ?? 3000);
