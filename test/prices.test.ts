import { expect, it } from "vitest";
import { prices } from "../src/models.ts";
import { provider } from "./helpers/boron.ts";

it("prices a request at the provider's own price, else the catalog price, else 0", () => {
	expect(prices(provider("a", { priceIn: 1, priceOut: 2 }))).toEqual({ input: 1, output: 2, cacheRead: 1, cacheWrite: 1 });
	expect(prices(provider("c", { kind: "pi", model: "claude-haiku-5-5", priceOut: 0 }))).toEqual({ input: 0.1, output: 0, cacheRead: 0.01, cacheWrite: 0.125 });
	// A free tier set as 0 makes cached input free too.
	expect(prices(provider("c", { kind: "pi", model: "claude-haiku-5-5", priceIn: 0, priceOut: 0 }))).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	expect(prices(provider("g", { kind: "gemini", model: "gemini-3.6-flash" }))).toMatchObject({ input: 0.75, output: 3.75 });
	expect(prices(provider("o", { model: "unknown" }))).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});
