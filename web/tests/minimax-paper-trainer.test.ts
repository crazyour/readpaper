import assert from "node:assert/strict";
import test from "node:test";

import { miniMaxJson, MiniMaxApiError } from "../shared/api/minimax";

test("MiniMax discovery selects a current model and parses fenced JSON", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
    if (url.endsWith("/models")) {
      return Response.json({ data: [{ id: "MiniMax-M3.1-Flash" }] });
    }
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "MiniMax-M3.1-Flash");
    return Response.json({
      choices: [{ message: { content: "```json\n{\"ok\":true}\n```" } }],
    });
  };
  assert.deepEqual(
    await miniMaxJson("system", "prompt", { apiKey: "secret", fetchImpl }),
    { ok: true },
  );
  assert.deepEqual(calls, [
    "https://api.minimax.io/v1/models",
    "https://api.minimax.io/v1/chat/completions",
  ]);
});

test("MiniMax discovery falls back from the global to the China platform", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://api.minimax.io/v1/models") {
      return new Response("unauthorized", { status: 401 });
    }
    if (url === "https://api.minimaxi.com/v1/models") {
      return Response.json({ data: [{ id: "MiniMax-M3" }] });
    }
    return Response.json({
      choices: [{ message: { content: '{"region":"china"}' } }],
    });
  };
  assert.deepEqual(
    await miniMaxJson("system", "prompt", { apiKey: "china-key", fetchImpl }),
    { region: "china" },
  );
  assert.equal(
    calls.at(-1),
    "https://api.minimaxi.com/v1/chat/completions",
  );
});

test("a missing MiniMax key fails with an actionable server error", async () => {
  await assert.rejects(
    miniMaxJson("system", "prompt", { apiKey: "" }),
    (error: unknown) =>
      error instanceof MiniMaxApiError &&
      error.status === 503 &&
      error.message.includes("MINIMAX_API_KEY"),
  );
});
