/** Stateless answer, hint, and summary actions backed by MiniMax. */

import {
  buildPaperHint,
  buildPaperSummary,
  gradePaperAnswer,
} from "@/lib/paper-trainer-engine";
import { MiniMaxApiError } from "@/shared/api/minimax";
import {
  normalizePaperDifficulty,
  type ModuleId,
} from "@/features/paper-trainer/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function moduleId(value: unknown): ModuleId | null {
  return value === "framing" || value === "implementation" ? value : null;
}

export async function POST(request: Request): Promise<Response> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 500_000) {
    return Response.json(
      { detail: "The training state is too large." },
      { status: 413 },
    );
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const selectedModule = moduleId(body.module);
    if (
      !selectedModule ||
      !["answer", "hint", "summary"].includes(String(body.action))
    ) {
      return Response.json(
        { detail: "Unknown paper training action." },
        { status: 400 },
      );
    }
    const common = {
      module: selectedModule,
      state: body.state,
      outline: body.outline,
      language: typeof body.language === "string" ? body.language : "en",
      difficulty: normalizePaperDifficulty(body.difficulty),
    };
    const state =
      body.action === "answer"
        ? await gradePaperAnswer({
            ...common,
            paperText: typeof body.paper_text === "string" ? body.paper_text : "",
            answer: typeof body.answer === "string" ? body.answer : "",
          })
        : body.action === "hint"
          ? await buildPaperHint({
              ...common,
              paperText: typeof body.paper_text === "string" ? body.paper_text : "",
            })
          : await buildPaperSummary(common);
    return Response.json(state);
  } catch (error) {
    if (error instanceof MiniMaxApiError) {
      return Response.json({ detail: error.message }, { status: error.status });
    }
    console.error("Paper training action failed", error);
    return Response.json(
      { detail: "The paper question could not be processed. Please try again." },
      { status: 502 },
    );
  }
}
