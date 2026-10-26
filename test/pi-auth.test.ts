import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { piCredentialStore } from "../src/pi-auth.ts";
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
