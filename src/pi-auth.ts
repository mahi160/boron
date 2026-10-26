import { readFile, writeFile } from "node:fs/promises";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";

/** How a login file's text maps to one pi-ai credential. */
export interface LoginFormat {
	/** The credential in `text`; `text` is undefined when the file does not exist. */
	read(text: string | undefined): Credential | undefined;
	/** The new file text holding `credential`, keeping everything else in `text`. */
	write(text: string | undefined, credential: Credential): string;
}

/** A credential file another tool owns, which Boron reads and refreshes but never logs out of. */
export interface LoginSource {
	path: string;
	format: LoginFormat;
	/** Shown when asked to log out. */
	logoutHint: string;
}

async function readText(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

/**
 * `source`'s login as the credential of every provider `owns` accepts. Refreshing rotates the refresh token, so
 * writes take pi's file lock and re-read the file first; the owning tool then sees the new token too.
 */
export function loginCredentialStore(source: LoginSource, owns: (providerId: string) => boolean): CredentialStore {
	const { path, format } = source;
	return {
		async read(providerId) {
			return owns(providerId) ? format.read(await readText(path)) : undefined;
		},
		async list(): Promise<readonly CredentialInfo[]> {
			return [];
		},
		async modify(providerId, fn) {
			if (!owns(providerId)) return fn(undefined);
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
				const text = await readText(path);
				const current = format.read(text);
				const next = await fn(current);
				if (compromised !== undefined) throw compromised;
				if (next === undefined) return current;
				await writeFile(path, format.write(text, next), { mode: 0o600 });
				return next;
			} finally {
				await release().catch(() => {});
			}
		},
		async delete() {
			throw new Error(`Boron does not log out of logins it borrows; ${source.logoutHint}`);
		},
	};
}

/** pi's key for the Claude login in its auth.json. */
const PI_PROVIDER = "anthropic";

type AuthFile = Record<string, Credential | undefined>;

const parseAuth = (text: string | undefined): AuthFile => (text === undefined ? {} : JSON.parse(text));

/** pi's auth.json: one credential per pi provider key. */
export const piAuthFormat: LoginFormat = {
	read: (text) => parseAuth(text)[PI_PROVIDER],
	write: (text, credential) => JSON.stringify({ ...parseAuth(text), [PI_PROVIDER]: credential }, null, 2),
};

/** pi's Claude login (`~/.pi/agent/auth.json`) as the credential of every Boron provider of kind "pi". */
export function piCredentialStore(path: string, isPiProvider: (providerId: string) => boolean): CredentialStore {
	return loginCredentialStore({ path, format: piAuthFormat, logoutHint: "run `pi` and use /logout there" }, isPiProvider);
}
