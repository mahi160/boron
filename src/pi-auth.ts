import { readFile, writeFile } from "node:fs/promises";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";

/** pi's key for the Claude login in its auth.json. */
const PI_PROVIDER = "anthropic";

type AuthFile = Record<string, Credential | undefined>;

async function readAuth(path: string): Promise<AuthFile> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
		throw error;
	}
}

/**
 * pi's Claude login (`~/.pi/agent/auth.json`) as the credential of every Boron provider of kind "pi". Refreshing
 * rotates the refresh token, so writes take the same file lock as pi and re-read the file first; pi then sees the
 * new token too. Boron never removes the login.
 */
export function piCredentialStore(path: string, isPiProvider: (providerId: string) => boolean): CredentialStore {
	const own = (id: string) => isPiProvider(id);
	return {
		async read(providerId) {
			return own(providerId) ? (await readAuth(path))[PI_PROVIDER] : undefined;
		},
		async list(): Promise<readonly CredentialInfo[]> {
			return [];
		},
		async modify(providerId, fn) {
			if (!own(providerId)) return fn(undefined);
			// A lost lock (another process took it as stale) must fail this write, not crash the server.
			let compromised: Error | undefined;
			// Same lock options as pi's own auth storage, so the two processes exclude each other.
			const release = await lockfile.lock(path, {
				realpath: false,
				stale: 30_000,
				retries: { retries: 30, minTimeout: 20, maxTimeout: 1_000 },
				onCompromised: (error) => {
					compromised = error;
				},
			});
			try {
				const auth = await readAuth(path);
				const next = await fn(auth[PI_PROVIDER]);
				if (compromised !== undefined) throw compromised;
				if (next === undefined) return auth[PI_PROVIDER];
				await writeFile(path, JSON.stringify({ ...auth, [PI_PROVIDER]: next }, null, 2), { mode: 0o600 });
				return next;
			} finally {
				await release().catch(() => {});
			}
		},
		async delete() {
			throw new Error("Boron does not log out of pi; run `pi` and use /logout there");
		},
	};
}
