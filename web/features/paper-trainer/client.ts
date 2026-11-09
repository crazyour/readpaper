/** Browser client for the Vercel-native, locally persisted paper trainer. */

import { requestJson } from "@/shared/api/client";

import { extractPaperText } from "./extract";
import {
  readPaperSession,
  saveModuleState,
  savePaperSession,
} from "./local-store";
import type { ModuleId, ModuleState, PaperState } from "./model";

const BASE = "/api/paper-trainer";

export const SUPPORTED_SUFFIXES = [".pdf", ".docx", ".txt", ".md"] as const;
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function isSupportedPaper(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function sourceUrl(file: File): string {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
}

/** Extract locally; only bounded text reaches the Vercel function. */
export async function uploadPaper(
  file: File,
  language: string,
): Promise<PaperState> {
  const paperText = await extractPaperText(file);
  const paper = await requestJson<PaperState>(`${BASE}/papers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      paper_text: paperText,
      language,
    }),
  });
  const livePaper = { ...paper, source_url: sourceUrl(file) };
  savePaperSession(livePaper, paperText);
  return livePaper;
}

/** Restore from this browser; Vercel holds no per-user database. */
export function getPaper(paperId: string): Promise<PaperState> {
  const stored = readPaperSession(paperId);
  return stored
    ? Promise.resolve(stored.paper)
    : Promise.reject(new Error("This paper is no longer available in this browser."));
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
