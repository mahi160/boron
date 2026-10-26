import { describe, expect, it } from "vitest";
import { compact, expand } from "../web/src/paragraphs.ts";

describe("compact paragraphs", () => {
	it("shows one line per paragraph and turns it back into the same Markdown", () => {
		const markdown = "# অধ্যায়\n\nএক।\n\nদুই।\n\n::: verse\nপ্রথম লাইন\nদ্বিতীয় লাইন\n:::\n\n| ক | খ |\n|---|---|\n| ১ | ২ |\n\n- এক\n- দুই\n\n[^1]: টীকা";
		const text = compact(markdown);
		expect(text).toBe("# অধ্যায়\nএক।\nদুই।\n::: verse\nপ্রথম লাইন\nদ্বিতীয় লাইন\n:::\n| ক | খ |\n|---|---|\n| ১ | ২ |\n- এক\n- দুই\n[^1]: টীকা");
		expect(expand(text ?? "")).toBe(markdown);
	});

	it("keeps Markdown whose paragraphs span several lines, which one line per paragraph would split", () => {
		expect(compact("এক লাইন\nআর এক লাইন\n\nদুই")).toBeNull();
	});

	it("treats every new line the user types as a new paragraph", () => {
		expect(expand("এক\nদুই\n\n\nতিন")).toBe("এক\n\nদুই\n\nতিন");
	});
});
