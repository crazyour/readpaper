/** Prepare a locally extracted paper through MiniMax. */

import { preparePaper } from "@/lib/paper-trainer-engine";
import { MiniMaxApiError } from "@/shared/api/minimax";
import { normalizePaperDifficulty } from "@/features/paper-trainer/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request): Promise<Response> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 400_000) {
    return Response.json(
      { detail: "The extracted paper is too large." },
      { status: 413 },
    );
  }
  try {
    const body = (await request.json()) as {
      filename?: unknown;
      paper_text?: unknown;
      language?: unknown;
      difficulty?: unknown;
    };
    if (
      typeof body.filename !== "string" ||
      typeof body.paper_text !== "string" ||
      body.paper_text.trim().length < 80
    ) {
      return Response.json(
        { detail: "A readable paper is required." },
        { status: 400 },
      );
    }
    const paper = await preparePaper({
      filename: body.filename,
      paperText: body.paper_text,
      language: typeof body.language === "string" ? body.language : "en",
      difficulty: normalizePaperDifficulty(body.difficulty),
    });
    return Response.json(paper);
  } catch (error) {
    if (error instanceof MiniMaxApiError) {
      return Response.json({ detail: error.message }, { status: error.status });
    }
    console.error("Preparing the paper failed", error);
    return Response.json(
      { detail: "The paper could not be prepared. Please try again." },
      { status: 502 },
    );
  }
}
