/** Server-side MiniMax JSON client used by the paper trainer. */

const API_BASES = [
  "https://api.minimax.io/v1",
  "https://api.minimaxi.com/v1",
] as const;

const PREFERRED_MODELS = [
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M3.1-Flash",
  "MiniMax-M3",
  "MiniMax-M2.7",
  "MiniMax-M2.5",
  "MiniMax-Text-01",
] as const;

interface MiniMaxConfig {
  baseUrl: string;
  model: string;
}

interface MiniMaxOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxTokens?: number;
  reasoningEffort?: "none" | "low";
}

let discoveredConfig: Promise<MiniMaxConfig> | null = null;

export class MiniMaxApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "MiniMaxApiError";
  }
}

function apiKey(options: MiniMaxOptions): string {
  const key = (options.apiKey ?? process.env.MINIMAX_API_KEY ?? "").trim();
  if (!key) {
    throw new MiniMaxApiError(
      "MINIMAX_API_KEY is not configured in the Vercel project.",
      503,
    );
  }
  return key;
}

function configuredModel(): MiniMaxConfig | null {
  const model = (process.env.MINIMAX_MODEL ?? "").trim();
  const baseUrl = (process.env.MINIMAX_API_BASE ?? "").trim().replace(/\/+$/, "");
  return model && baseUrl ? { model, baseUrl } : null;
}

function reasoningBody(
  model: string,
  effort: "none" | "low",
): Record<string, unknown> {
  const normalized = model.toLowerCase();
  if (normalized === "minimax-m3") {
    return {
      thinking: { type: effort === "none" ? "disabled" : "adaptive" },
    };
  }
  if (normalized === "minimax-m3.1-flash") {
    // Flash always reasons adaptively; low is its cheapest supported effort.
    return {
      thinking: { type: "adaptive" },
      reasoning_split: true,
      reasoning_effort: "low",
    };
  }
  return effort === "none"
    ? { reasoning_split: false }
    : { reasoning_split: true, reasoning_effort: "low" };
}

function preferredModel(models: unknown): string | null {
  if (!Array.isArray(models)) return null;
  const names = models.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? [id.trim()] : [];
  });
  const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const preferred of PREFERRED_MODELS) {
    const match = byLower.get(preferred.toLowerCase());
    if (match) return match;
  }
  return names[0] ?? null;
}

async function discover(
  key: string,
  fetchImpl: typeof fetch,
): Promise<MiniMaxConfig> {
  let authenticationFailed = false;
  for (const baseUrl of API_BASES) {
    try {
      const response = await fetchImpl(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        authenticationFailed = true;
        continue;
      }
      if (!response.ok) continue;
      const body = (await response.json()) as { data?: unknown };
      const model = preferredModel(body.data);
      if (model) return { baseUrl, model };
    } catch {
      // Try the other MiniMax region. Keys are issued per platform.
    }
  }
  throw new MiniMaxApiError(
    authenticationFailed
      ? "The MiniMax API key was rejected. Check that it is copied completely."
      : "MiniMax could not be reached or returned no available text model.",
    authenticationFailed ? 401 : 503,
  );
}

function jsonObject(content: string): Record<string, unknown> {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const unfenced = withoutThinking
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new MiniMaxApiError("MiniMax returned an answer that was not JSON.");
  }
  try {
    const value = JSON.parse(unfenced.slice(first, last + 1));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new MiniMaxApiError("MiniMax returned malformed JSON. Please try again.");
  }
}

/** Call the regional MiniMax OpenAI-compatible endpoint and parse one object. */
export async function miniMaxJson(
  system: string,
  prompt: string,
  options: MiniMaxOptions = {},
): Promise<Record<string, unknown>> {
  const started = performance.now();
  const key = apiKey(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = options.fetchImpl
    ? await discover(key, fetchImpl)
    : configuredModel() ??
      (await (discoveredConfig ??= discover(key, fetchImpl).catch((error) => {
          discoveredConfig = null;
          throw error;
        })));

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        // The trainer expects compact structured feedback, not an essay.
        max_tokens: options.maxTokens ?? 2_400,
        temperature: 0.1,
        ...reasoningBody(config.model, options.reasoningEffort ?? "none"),
      }),
      signal: AbortSignal.timeout(150_000),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new MiniMaxApiError(
      timedOut
        ? "MiniMax took too long to read the paper. Please try again."
        : "MiniMax could not be reached. Please try again.",
      503,
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) discoveredConfig = null;
    throw new MiniMaxApiError(
      response.status === 401 || response.status === 403
        ? "The MiniMax API key was rejected."
        : `MiniMax request failed with HTTP ${response.status}.`,
      response.status === 429 ? 429 : response.status >= 500 ? 503 : 502,
    );
  }
  let body: {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new MiniMaxApiError("MiniMax returned an invalid response. Please try again.");
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new MiniMaxApiError("MiniMax returned an empty answer.");
  }
  const result = jsonObject(content);
  console.info("Paper trainer MiniMax call", {
    model: config.model,
    promptChars: system.length + prompt.length,
    elapsedMs: Math.round(performance.now() - started),
  });
  return result;
}
