/** Browser client for the Vercel-native, locally persisted paper trainer. */

import { extractPaperText } from "./extract";
import {
  readPaperSession,
  saveModuleState,
  savePaperSession,
} from "./local-store";
import type {
  ModuleId,
  ModuleState,
  PaperDifficulty,
  PaperState,
} from "./model";
import { paperSourceUrl, savePaperSourceFile } from "./source-file-store";

const BASE = "/api/paper-trainer";

class PaperTrainerHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PaperTrainerHttpError";
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    const detail = body?.detail;
    throw new PaperTrainerHttpError(
      typeof detail === "string" && detail.trim()
        ? detail
        : `Request failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  if (!body) throw new Error("The server returned an invalid response.");
  return body as T;
}

export const SUPPORTED_SUFFIXES = [".pdf", ".docx", ".txt", ".md"] as const;
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function isSupportedPaper(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function sourceUrl(file: File): string {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
}

/** Extract the file locally and send only bounded text to the same-origin route. */
export async function uploadPaper(
  file: File,
  language: string,
  difficulty: PaperDifficulty,
): Promise<PaperState> {
  const paperText = await extractPaperText(file);
  const paper = await requestJson<PaperState>(`${BASE}/papers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      paper_text: paperText,
      language,
      difficulty,
    }),
  });
  await savePaperSourceFile(paper.paper_id, file);
  const livePaper = {
    ...paper,
    difficulty,
    source_url: (await paperSourceUrl(paper.paper_id)) || sourceUrl(file),
  };
  savePaperSession(livePaper, paperText);
  return livePaper;
}

/** Restore from this browser; Vercel holds no per-user database. */
export async function getPaper(paperId: string): Promise<PaperState> {
  const stored = readPaperSession(paperId);
  if (!stored) {
    throw new Error("This paper is no longer available in this browser.");
  }
  if (stored.paper.source_url) return stored.paper;
  const restoredUrl = await paperSourceUrl(paperId);
  if (!restoredUrl) return stored.paper;
  const paper = { ...stored.paper, source_url: restoredUrl };
  savePaperSession(paper, stored.paperText);
  return paper;
}

async function runAction(
  paperId: string,
  module: ModuleId,
  action: "answer" | "hint" | "summary",
  language: string,
  answer = "",
): Promise<ModuleState> {
  const stored = readPaperSession(paperId);
  const state = stored?.paper.modules[module];
  if (!stored || !state) {
    throw new Error("This paper is no longer available in this browser.");
  }
  const next = await requestJson<ModuleState>(`${BASE}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      module,
      state,
      outline: stored.paper.outline,
      paper_text: stored.paperText,
      language,
      difficulty: stored.paper.difficulty,
      answer,
    }),
  });
  saveModuleState(paperId, module, next);
  return next;
}

export function submitAnswer(
  paperId: string,
  module: ModuleId,
  answer: string,
  language: string,
): Promise<ModuleState> {
  return runAction(paperId, module, "answer", language, answer);
}

/** Advancing is a local state transition and does not spend a model call. */
export async function advanceModule(
  paperId: string,
  module: ModuleId,
): Promise<ModuleState> {
  const stored = readPaperSession(paperId);
  const current = stored?.paper.modules[module];
  if (!current) {
    throw new Error("This paper is no longer available in this browser.");
  }
  if (!current.pending_question) {
    throw new Error("Answer the current question first.");
  }
  const next: ModuleState = {
    ...current,
    current_question: current.pending_question,
    current_focus: current.pending_focus,
    pending_question: "",
    pending_focus: "",
    hint: "",
    hint_evidence: [],
    finished: false,
  };
  saveModuleState(paperId, module, next);
  return next;
}

export function requestHint(
  paperId: string,
  module: ModuleId,
  language: string,
): Promise<ModuleState> {
  return runAction(paperId, module, "hint", language);
}

export function requestSummary(
  paperId: string,
  module: ModuleId,
  language: string,
): Promise<ModuleState> {
  return runAction(paperId, module, "summary", language);
}
