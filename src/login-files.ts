import { readFile, writeFile } from "node:fs/promises";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";
import { isObj, type Obj } from "./json.ts";

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

/** The credential `source` holds now, if any. */
export async function readLogin(source: LoginSource): Promise<Credential | undefined> {
	return source.format.read(await readText(source.path));
}

/**
 * Each provider's login (`sourceOf`) as its credential. Refreshing rotates the refresh token, so writes take pi's file
 * lock and re-read the file first; the owning tool then sees the new token too. Boron never removes a login.
 */
export function loginCredentialStore(sourceOf: (providerId: string) => LoginSource | undefined): CredentialStore {
	return {
		async read(providerId) {
			const source = sourceOf(providerId);
			return source === undefined ? undefined : readLogin(source);
		},
		async list(): Promise<readonly CredentialInfo[]> {
			return [];
		},
		async modify(providerId, fn) {
			const source = sourceOf(providerId);
			if (source === undefined) return fn(undefined);
			// A lost lock (another process took it as stale) must fail this write, not crash the server.
			let compromised: Error | undefined;
			// Same lock options as pi's own auth storage, so the two processes exclude each other.
			const release = await lockfile.lock(source.path, {
				realpath: false,
				stale: 30_000,
				retries: { retries: 30, minTimeout: 20, maxTimeout: 1_000 },
				onCompromised: (error) => {
					compromised = error;
				},
			});
			try {
				const text = await readText(source.path);
				const current = source.format.read(text);
				const next = await fn(current);
				if (compromised !== undefined) throw compromised;
				if (next === undefined) return current;
				await writeFile(source.path, source.format.write(text, next), { mode: 0o600 });
				return next;
			} finally {
				await release().catch(() => {});
			}
		},
		async delete(providerId) {
			throw new Error(`Boron does not log out of logins it borrows; ${sourceOf(providerId)?.logoutHint ?? "log out in the tool that owns it"}`);
		},
	};
}

const parseObj = (text: string | undefined): Obj => {
	const value: unknown = text === undefined ? {} : JSON.parse(text);
	return isObj(value) ? value : {};
};
const str = (o: Obj | undefined, key: string): string | undefined => {
	const value = o?.[key];
	return typeof value === "string" && value !== "" ? value : undefined;
};
const obj = (o: Obj, key: string): Obj | undefined => {
	const value = o[key];
	return isObj(value) ? value : undefined;
};

/** One OAuth login under `key` in pi's auth.json (the shape of pi-ai's credentials). */
export function piAuthFormat(key: string): LoginFormat {
	return {
		read(text) {
			const entry = obj(parseObj(text), key);
			const access = str(entry, "access");
			const refresh = str(entry, "refresh");
			const expires = entry?.expires;
			if (entry?.type !== "oauth" || access === undefined || refresh === undefined || typeof expires !== "number") return undefined;
			return { ...entry, type: "oauth", access, refresh, expires };
		},
		write: (text, credential) => JSON.stringify({ ...parseObj(text), [key]: credential }, null, 2),
	};
}

/**
 * Claude Code's `~/.claude/.credentials.json` on Linux:
 * `{"claudeAiOauth": {"accessToken", "refreshToken", "expiresAt" (ms), "scopes", "subscriptionType"}}`.
 */
export const claudeCodeFormat: LoginFormat = {
	read(text) {
		const entry = obj(parseObj(text), "claudeAiOauth");
		const access = str(entry, "accessToken");
		const refresh = str(entry, "refreshToken");
		const expires = entry?.expiresAt;
		if (access === undefined || refresh === undefined || typeof expires !== "number") return undefined;
		return { type: "oauth", access, refresh, expires };
	},
	write(text, credential) {
		if (credential.type !== "oauth") throw new Error("Claude Code holds only an OAuth login");
		const file = parseObj(text);
		const claudeAiOauth = { ...obj(file, "claudeAiOauth"), accessToken: credential.access, refreshToken: credential.refresh, expiresAt: credential.expires };
		return JSON.stringify({ ...file, claudeAiOauth });
	},
};

/** Seconds-since-epoch `exp` of a JWT, as milliseconds; 0 (expired) when unreadable. */
function jwtExpiry(token: string): number {
	try {
		const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
		return isObj(payload) && typeof payload.exp === "number" ? payload.exp * 1000 : 0;
	} catch {
		return 0;
	}
}

/**
 * Codex's `~/.codex/auth.json` signed in with ChatGPT:
 * `{"OPENAI_API_KEY": null, "tokens": {"id_token", "access_token", "refresh_token", "account_id"}, "last_refresh"}`.
 */
export const codexFormat: LoginFormat = {
	read(text) {
		const tokens = obj(parseObj(text), "tokens");
		const access = str(tokens, "access_token");
		const refresh = str(tokens, "refresh_token");
		if (access === undefined || refresh === undefined) return undefined;
		const accountId = str(tokens, "account_id");
		return { type: "oauth", access, refresh, expires: jwtExpiry(access), ...(accountId === undefined ? {} : { accountId }) };
	},
	write(text, credential) {
		if (credential.type !== "oauth") throw new Error("Codex holds only an OAuth login here");
		const file = parseObj(text);
		const accountId = typeof credential.accountId === "string" ? { account_id: credential.accountId } : {};
		const tokens = { ...obj(file, "tokens"), access_token: credential.access, refresh_token: credential.refresh, ...accountId };
		return JSON.stringify({ ...file, tokens, last_refresh: new Date().toISOString() }, null, 2);
	},
};

/** Codex's auth.json holding only an OpenAI API key (`{"OPENAI_API_KEY": "sk-..."}`). */
export const codexKeyFormat: LoginFormat = {
	read(text) {
		const file = parseObj(text);
		const key = str(file, "OPENAI_API_KEY");
		return key === undefined || obj(file, "tokens") !== undefined ? undefined : { type: "api_key", key };
	},
	write(text, credential) {
		if (credential.type !== "api_key") throw new Error("expected an API key");
		return JSON.stringify({ ...parseObj(text), OPENAI_API_KEY: credential.key }, null, 2);
	},
};
