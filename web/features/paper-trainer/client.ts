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

const BASE = "/api/paper-trainer";

function cloudApiRoot(): string {
  const configured = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
  if (!configured) return "";
  const base = configured.replace(/\/+$/, "");
  return base.endsWith("/api")
    ? `${base}/paper-trainer`
    : `${base}/api/paper-trainer`;
}

function actionQuery(language: string, difficulty: PaperDifficulty): string {
  return new URLSearchParams({ language, difficulty }).toString();
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string" && detail.trim()
        ? detail
        : `Request failed with HTTP ${response.status}.`,
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

function absoluteCloudUrl(apiRoot: string, value: string): string {
  if (!value || /^(?:https?:|blob:|data:)/i.test(value)) return value;
  try {
    return new URL(value, apiRoot).toString();
  } catch {
    return value;
  }
}

async function uploadToCloud(
  apiRoot: string,
  file: File,
  language: string,
  difficulty: PaperDifficulty,
): Promise<PaperState> {
  const body = new FormData();
  body.append("file", file, file.name);
  body.append("language", language);
  body.append("difficulty", difficulty);
  const paper = await requestJson<PaperState>(`${apiRoot}/papers`, {
    method: "POST",
    body,
    credentials: "include",
  });
  const livePaper = {
    ...paper,
    difficulty,
    source_url:
      absoluteCloudUrl(apiRoot, paper.source_url) || sourceUrl(file),
  };
  savePaperSession(livePaper, "", { kind: "cloud", baseUrl: apiRoot });
  return livePaper;
}

/** Use the configured DeepTutor backend first, with a browser-only fallback. */
export async function uploadPaper(
  file: File,
  language: string,
  difficulty: PaperDifficulty,
): Promise<PaperState> {
  const apiRoot = cloudApiRoot();
  if (apiRoot) {
    try {
      return await uploadToCloud(apiRoot, file, language, difficulty);
    } catch (error) {
      console.warn("DeepTutor cloud parsing failed; using local extraction.", error);
    }
  }
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
  const livePaper = { ...paper, difficulty, source_url: sourceUrl(file) };
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
  if (stored.backend.kind === "cloud") {
    const suffix =
      action === "answer"
        ? "answer"
        : action === "hint"
          ? "hint"
          : "summary";
    const next = await requestJson<ModuleState>(
      `${stored.backend.baseUrl}/papers/${encodeURIComponent(paperId)}/modules/${module}/${suffix}?${actionQuery(language, stored.paper.difficulty)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "answer" ? JSON.stringify({ answer }) : undefined,
        credentials: "include",
      },
    );
    saveModuleState(paperId, module, next);
    return next;
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
  if (stored.backend.kind === "cloud") {
    const next = await requestJson<ModuleState>(
      `${stored.backend.baseUrl}/papers/${encodeURIComponent(paperId)}/modules/${module}/advance`,
      { method: "POST", credentials: "include" },
    );
    saveModuleState(paperId, module, next);
    return next;
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
