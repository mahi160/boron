import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { tempDir } from "./helpers/books.ts";

const dir = await tempDir();
process.env.BORON_PI_AUTH = join(dir, "pi", "auth.json");
process.env.BORON_CLAUDE_CREDENTIALS = join(dir, "claude", ".credentials.json");
process.env.BORON_CODEX_AUTH = join(dir, "codex", "auth.json");
const { detectLogins } = await import("../src/logins.ts");

it("detects nothing, without an error, when no login folder exists", async () => {
	expect(await detectLogins()).toEqual([]);
});

it("lists pi's Claude and ChatGPT logins, Claude Code and Codex, with image models only and no secrets", async () => {
	const oauth = { type: "oauth", access: "SECRET-A", refresh: "SECRET-R", expires: 1 };
	for (const sub of ["pi", "claude", "codex"]) await mkdir(join(dir, sub), { recursive: true });
	await writeFile(process.env.BORON_PI_AUTH ?? "", JSON.stringify({ anthropic: oauth, "openai-codex": oauth, google: { type: "api_key", key: "SECRET-K" } }));
	await writeFile(process.env.BORON_CLAUDE_CREDENTIALS ?? "", JSON.stringify({ claudeAiOauth: { accessToken: "SECRET-A", refreshToken: "SECRET-R", expiresAt: 1 } }));
	await writeFile(process.env.BORON_CODEX_AUTH ?? "", JSON.stringify({ tokens: { access_token: "SECRET-A", refresh_token: "SECRET-R" } }));

	const found = await detectLogins();
	expect(found.map((l) => l.id)).toEqual(["pi-claude", "pi-chatgpt", "claude-code", "codex"]);
	expect(JSON.stringify(found)).not.toContain("SECRET");
	for (const login of found) {
		expect(login.models.length).toBeGreaterThan(0);
		expect(login.models).toContain(login.defaultModel);
	}
	// gpt-6-astra cannot turn thinking off.
	expect(found.find((l) => l.id === "codex")?.models).not.toContain("gpt-6-astra");
});
