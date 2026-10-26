import type { Provider, ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { paths } from "./config.ts";
import { claudeCodeFormat, codexFormat, codexKeyFormat, type LoginSource, piAuthFormat, readLogin } from "./login-files.ts";

export const LOGIN_IDS = ["pi-claude", "pi-chatgpt", "claude-code", "codex", "codex-key"] as const;
export type LoginId = (typeof LOGIN_IDS)[number];

type Login = {
	/** The tool whose login file this is, for Detected logins and the health check. */
	tool: "pi" | "Claude Code" | "Codex";
	label: string;
	defaultModel: string;
	/** pi-ai's provider for this login: its auth (OAuth refresh or key), catalog and endpoint. */
	provider: () => Provider;
	api: () => ProviderStreams;
	/** Which of the provider's auth methods the login file feeds. */
	auth: "oauth" | "apiKey";
	source: () => LoginSource;
};

const PI_LOGOUT = "run `pi` and use /logout there";

export const LOGINS: Record<LoginId, Login> = {
	"pi-claude": {
		tool: "pi",
		label: "Claude (pi login)",
		defaultModel: "claude-haiku-5-5",
		provider: anthropicProvider,
		api: anthropicMessagesApi,
		auth: "oauth",
		source: () => ({ path: paths.piAuth, format: piAuthFormat("anthropic"), logoutHint: PI_LOGOUT }),
	},
	"pi-chatgpt": {
		tool: "pi",
		label: "ChatGPT (pi login)",
		defaultModel: "gpt-6-luna",
		provider: openaiCodexProvider,
		api: openAICodexResponsesApi,
		auth: "oauth",
		source: () => ({ path: paths.piAuth, format: piAuthFormat("openai-codex"), logoutHint: PI_LOGOUT }),
	},
	"claude-code": {
		tool: "Claude Code",
		label: "Claude (Claude Code login)",
		defaultModel: "claude-haiku-5-5",
		provider: anthropicProvider,
		api: anthropicMessagesApi,
		auth: "oauth",
		source: () => ({ path: paths.claudeCodeCredentials, format: claudeCodeFormat, logoutHint: "run `claude` and use /logout there" }),
	},
	codex: {
		tool: "Codex",
		label: "ChatGPT (Codex login)",
		defaultModel: "gpt-6-luna",
		// Codex signs in with the same OAuth client as pi-ai's Codex provider, so its refresh token works there.
		provider: openaiCodexProvider,
		api: openAICodexResponsesApi,
		auth: "oauth",
		source: () => ({ path: paths.codexAuth, format: codexFormat, logoutHint: "run `codex logout`" }),
	},
	"codex-key": {
		tool: "Codex",
		label: "OpenAI API key (from Codex)",
		defaultModel: "gpt-6-luna",
		provider: openaiProvider,
		api: openAIResponsesApi,
		auth: "apiKey",
		source: () => ({ path: paths.codexAuth, format: codexKeyFormat, logoutHint: "edit Codex's auth.json" }),
	},
};

export const isLoginId = (value: unknown): value is LoginId => LOGIN_IDS.some((id) => id === value);

/** Models of `login`'s catalog that read images and can run with thinking off (pi-durable sends no reasoning level). */
export function loginModelIds(login: LoginId): string[] {
	return LOGINS[login]
		.provider()
		.getModels()
		.flatMap((m) => (m.input.includes("image") && m.thinkingLevelMap?.off !== null ? [m.id] : []));
}

export type DetectedLogin = { id: LoginId; tool: Login["tool"]; label: string; defaultModel: string; models: string[] };

/** Logins present on this machine; never includes a token. A missing or unreadable file is simply not detected. */
export async function detectLogins(): Promise<DetectedLogin[]> {
	const found = await Promise.all(
		LOGIN_IDS.map(async (id) => ((await readLogin(LOGINS[id].source()).catch(() => undefined)) === undefined ? [] : [id])),
	);
	return found.flat().map((id) => {
		const { tool, label, defaultModel } = LOGINS[id];
		return { id, tool, label, defaultModel, models: loginModelIds(id) };
	});
}
