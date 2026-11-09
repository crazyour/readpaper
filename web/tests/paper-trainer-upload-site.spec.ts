import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where the paper upload goes.
 *
 * Same-origin by default (the Next route handler streams it to FastAPI). On a
 * host that caps request bodies — Vercel Functions stop at 4.5 MB, which a PDF
 * routinely exceeds — the browser has to reach the API host directly.
 */
const directBase = { value: null as string | null };

vi.mock("@/lib/backend-public-base", () => ({
  publicBackendBase: () => directBase.value,
}));

vi.mock("@/lib/workspace-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-scope")>();
  return { ...actual, activeWorkspaceId: () => "ws-1" };
});

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

let calls: string[];

beforeEach(() => {
  directBase.value = null;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify(paperBody()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

describe("paper upload target", () => {
  it("stays same-origin when no public backend is configured", async () => {
    await uploadPaper(new File(["x"], "plan.pdf"), "en");
    expect(calls[0]).toContain("/api/paper-trainer/papers");
    expect(calls[0]!.startsWith("http")).toBe(false);
  });

  it("goes straight to the API host when one is configured", async () => {
    directBase.value = "https://deeptutor-api.fly.dev";
    await uploadPaper(new File(["x"], "plan.pdf"), "en");
    expect(calls[0]).toBe(
      "https://deeptutor-api.fly.dev/api/paper-trainer/papers?dt_workspace=ws-1",
    );
  });
});
