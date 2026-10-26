import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

const server = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => (body += chunk));
	req.on("end", () => {
		if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen2.5vl:7b" }, { name: "llama3:8b" }] }));
		const { model } = JSON.parse(body);
		res.end(JSON.stringify({ capabilities: model === "qwen2.5vl:7b" ? ["completion", "vision"] : ["completion"] }));
	});
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.BORON_OLLAMA_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { detectOllama } = await import("../src/ollama.ts");

it("finds a local Ollama and offers only its vision models", async () => {
	expect(await detectOllama()).toEqual({ baseUrl: `${process.env.BORON_OLLAMA_URL}/v1`, models: ["qwen2.5vl:7b"] });
	server.close();
	expect(await detectOllama()).toBeNull();
});
