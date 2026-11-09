import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/paper-trainer/extract", () => ({
  extractPaperText: async () => "Local extracted text ".repeat(20),
}));

import { uploadPaper } from "@/features/paper-trainer/client";

function paperBody() {
  return {
    paper_id: "p1",
    filename: "plan.pdf",
    title: "A paper",
    source_url: "",
    outline: {},
    modules: {},
    created_at: 0,
    updated_at: 0,
  };
}

let calls: Array<{ url: string; init?: RequestInit }>;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        init,
      });
      return new Response(JSON.stringify(paperBody()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

describe("paper upload target", () => {
  it("sends extracted text to the same-origin Vercel route", async () => {
    await uploadPaper(new File(["binary pdf"], "plan.pdf"), "zh");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/paper-trainer/papers");
    expect(calls[0]!.url.startsWith("http")).toBe(false);
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toMatchObject({
      filename: "plan.pdf",
      language: "zh",
      paper_text: "Local extracted text ".repeat(20),
    });
    expect(calls[0]!.init?.body).not.toBeInstanceOf(FormData);
  });
});
