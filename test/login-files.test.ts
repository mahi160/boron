import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { claudeCodeFormat, codexFormat, codexKeyFormat, type LoginFormat, loginCredentialStore, piAuthFormat } from "../src/login-files.ts";
import { tempDir } from "./helpers/books.ts";

it("reads pi's Claude login for its providers only and writes a refresh back without touching other logins", async () => {
	const dir = await tempDir();
	const path = join(dir, "auth.json");
	const old = { type: "oauth" as const, access: "a1", refresh: "r1", expires: 1 };
	await writeFile(path, JSON.stringify({ anthropic: old, google: { type: "api_key", key: "g" } }));
	const source = { path, format: piAuthFormat("anthropic"), logoutHint: "run `pi` and use /logout there" };
	const store = loginCredentialStore((id) => (id === "pi" ? source : undefined));

	expect(await store.read("pi")).toEqual(old);
	expect(await store.read("gemini")).toBeUndefined();

	const next = { type: "oauth" as const, access: "a2", refresh: "r2", expires: 2 };
	expect(await store.modify("pi", async (current) => (current?.type === "oauth" && current.refresh === "r1" ? next : undefined))).toEqual(next);
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ anthropic: next, google: { type: "api_key", key: "g" } });
	// The lock is released.
	expect(await readdir(dir)).toEqual(["auth.json"]);
	await expect(store.delete("pi")).rejects.toThrow(/does not log out/);
});

it("reads and refreshes a login through any format adapter, keeping the rest of the file", async () => {
	const dir = await tempDir();
	const path = join(dir, "creds.txt");
	await writeFile(path, "keep\nr1");
	// Fake format: last line is the refresh token, earlier lines are untouched.
	const format: LoginFormat = {
		read: (text) => (text === undefined ? undefined : { type: "oauth", access: "a", refresh: text.split("\n").at(-1) ?? "", expires: 0 }),
		write: (text, c) => [...(text ?? "").split("\n").slice(0, -1), c.type === "oauth" ? c.refresh : ""].join("\n"),
	};
	const store = loginCredentialStore((id) => (id === "x" ? { path, format, logoutHint: "use the tool" } : undefined));

	expect(await store.read("x")).toMatchObject({ refresh: "r1" });
	expect(await store.read("y")).toBeUndefined();
	await store.modify("x", async () => ({ type: "oauth", access: "a2", refresh: "r2", expires: 1 }));
	expect(await readFile(path, "utf8")).toBe("keep\nr2");
	expect(await store.modify("x", async () => undefined)).toMatchObject({ refresh: "r2" });
	expect(await readdir(dir)).toEqual(["creds.txt"]);
	await expect(store.delete("x")).rejects.toThrow(/use the tool/);
});

it("maps Claude Code's credentials file, keeping its scopes and plan", () => {
	const file = JSON.stringify({ claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: 5, scopes: ["user:inference"], subscriptionType: "max" }, other: 1 });
	expect(claudeCodeFormat.read(file)).toEqual({ type: "oauth", access: "a", refresh: "r", expires: 5 });
	expect(claudeCodeFormat.read(undefined)).toBeUndefined();
	expect(JSON.parse(claudeCodeFormat.write(file, { type: "oauth", access: "a2", refresh: "r2", expires: 9 }))).toEqual({
		claudeAiOauth: { accessToken: "a2", refreshToken: "r2", expiresAt: 9, scopes: ["user:inference"], subscriptionType: "max" },
		other: 1,
	});
});

it("maps Codex's auth file: a ChatGPT login with its JWT expiry, or an API key only", () => {
	const jwt = `x.${Buffer.from(JSON.stringify({ exp: 100 })).toString("base64url")}.y`;
	const chatgpt = JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: "i", access_token: jwt, refresh_token: "r", account_id: "acc" }, last_refresh: "old" });
	expect(codexFormat.read(chatgpt)).toEqual({ type: "oauth", access: jwt, refresh: "r", expires: 100_000, accountId: "acc" });
	expect(codexKeyFormat.read(chatgpt)).toBeUndefined();
	const written = JSON.parse(codexFormat.write(chatgpt, { type: "oauth", access: "a2", refresh: "r2", expires: 1, accountId: "acc" }));
	expect(written.tokens).toEqual({ id_token: "i", access_token: "a2", refresh_token: "r2", account_id: "acc" });
	expect(written.last_refresh).not.toBe("old");

	const keyOnly = JSON.stringify({ OPENAI_API_KEY: "sk-1" });
	expect(codexFormat.read(keyOnly)).toBeUndefined();
	expect(codexKeyFormat.read(keyOnly)).toEqual({ type: "api_key", key: "sk-1" });
});
