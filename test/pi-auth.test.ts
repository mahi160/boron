import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type LoginFormat, loginCredentialStore, piCredentialStore } from "../src/pi-auth.ts";
import { tempDir } from "./helpers/books.ts";

it("reads pi's Claude login for pi providers only and writes a refresh back without touching other logins", async () => {
	const dir = await tempDir();
	const path = join(dir, "auth.json");
	const old = { type: "oauth" as const, access: "a1", refresh: "r1", expires: 1 };
	await writeFile(path, JSON.stringify({ anthropic: old, google: { type: "api_key", key: "g" } }));
	const store = piCredentialStore(path, (id) => id === "pi");

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
	const store = loginCredentialStore({ path, format, logoutHint: "use the tool" }, (id) => id === "x");

	expect(await store.read("x")).toMatchObject({ refresh: "r1" });
	expect(await store.read("y")).toBeUndefined();
	await store.modify("x", async () => ({ type: "oauth", access: "a2", refresh: "r2", expires: 1 }));
	expect(await readFile(path, "utf8")).toBe("keep\nr2");
	expect(await store.modify("x", async () => undefined)).toMatchObject({ refresh: "r2" });
	expect(await readdir(dir)).toEqual(["creds.txt"]);
	await expect(store.delete("x")).rejects.toThrow(/use the tool/);
});
