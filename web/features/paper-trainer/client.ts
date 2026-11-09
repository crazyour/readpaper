/**
 * REST client for the paper-reading trainer.
 *
 * The trainer's state lives on the server, keyed by paper id and module, so a
 * refresh restores both modules exactly as they were. Every call returns the
 * module's whole state; the UI replaces what it had rather than patching it,
 * which keeps the two modules from ever drifting into each other.
 */

import { apiUrl, requestJson } from "@/shared/api/client";
import { publicBackendBase } from "@/lib/backend-public-base";
import { activeWorkspaceId } from "@/lib/workspace-scope";

import type { ModuleId, ModuleState, PaperState } from "./model";

const BASE = "/api/paper-trainer";

export const SUPPORTED_SUFFIXES = [".pdf", ".docx", ".txt", ".md"] as const;

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function isSupportedPaper(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Where the multipart upload should go.
 *
 * Same-origin by default, which the Next route handler streams to FastAPI. On
 * a host that caps request bodies (Vercel Functions stop at 4.5 MB) the paper
 * goes straight to the API instead — the browser can send it, a serverless
 * function cannot.
 */
function uploadUrl(): string {
  const direct = publicBackendBase();
  if (!direct) return apiUrl(`${BASE}/papers`);
  const workspace = activeWorkspaceId();
  return `${direct}${BASE}/papers?dt_workspace=${encodeURIComponent(workspace)}`;
}

/** Upload a paper. Both modules come back already opened. */
export async function uploadPaper(
  file: File,
  language: string,
): Promise<PaperState> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("language", language);
  // No Content-Type header: the browser writes the multipart boundary itself.
  return requestJson<PaperState>(uploadUrl(), {
    method: "POST",
    body: form,
  });
}

/** Restore a paper and both modules — the reload path. */
export function getPaper(paperId: string): Promise<PaperState> {
  return requestJson<PaperState>(
    apiUrl(`${BASE}/papers/${encodeURIComponent(paperId)}`),
  );
}

export function submitAnswer(
  paperId: string,
  module: ModuleId,
  answer: string,
  language: string,
): Promise<ModuleState> {
  return requestJson<ModuleState>(
    apiUrl(
      `${BASE}/papers/${encodeURIComponent(paperId)}/modules/${module}/answer?language=${encodeURIComponent(language)}`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    },
  );
}

/** Move the module on to the question the last answer earned. */
export function advanceModule(
  paperId: string,
  module: ModuleId,
): Promise<ModuleState> {
  return requestJson<ModuleState>(
    apiUrl(
      `${BASE}/papers/${encodeURIComponent(paperId)}/modules/${module}/advance`,
    ),
    { method: "POST" },
  );
}

export function requestHint(
  paperId: string,
  module: ModuleId,
  language: string,
): Promise<ModuleState> {
  return requestJson<ModuleState>(
    apiUrl(
      `${BASE}/papers/${encodeURIComponent(paperId)}/modules/${module}/hint?language=${encodeURIComponent(language)}`,
    ),
    { method: "POST" },
  );
}

export function requestSummary(
  paperId: string,
  module: ModuleId,
  language: string,
): Promise<ModuleState> {
  return requestJson<ModuleState>(
    apiUrl(
      `${BASE}/papers/${encodeURIComponent(paperId)}/modules/${module}/summary?language=${encodeURIComponent(language)}`,
    ),
    { method: "POST" },
  );
}
