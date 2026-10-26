import { homedir } from "node:os";
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
	// Login files of other tools, borrowed by providers of kind "login" (in Docker, mount the folders; see README).
	piAuth: process.env.BORON_PI_AUTH ?? join(homedir(), ".pi", "agent", "auth.json"),
	claudeCodeCredentials: process.env.BORON_CLAUDE_CREDENTIALS ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ".credentials.json"),
	codexAuth: process.env.BORON_CODEX_AUTH ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"),
};

export const PORT = Number(process.env.PORT ?? 3000);
