/**
 * Unsubmitted answers, kept per paper and per module.
 *
 * The two columns are independent while the student types: a draft in one is
 * never touched by a submit in the other, and it survives a reload. Submitting
 * clears only that module's draft. Storage is best-effort — a browser with
 * local storage disabled still works, it just forgets drafts.
 */

import { browserStorage } from "@/shared/storage";

import type { ModuleId } from "./model";

const NAMESPACE = "deeptutor:v2:paper-trainer:";
const LAST_PAPER = `${NAMESPACE}last-paper`;

function draftKey(paperId: string, module: ModuleId): string {
  return `${NAMESPACE}draft:${paperId}:${module}`;
}

export function readLastPaperId(): string {
  return browserStorage.readRaw("local", LAST_PAPER) ?? "";
}

export function writeLastPaperId(paperId: string): void {
  if (paperId) browserStorage.writeRaw("local", LAST_PAPER, paperId);
  else browserStorage.removeRaw("local", LAST_PAPER);
}

export function readDraft(paperId: string, module: ModuleId): string {
  return browserStorage.readRaw("local", draftKey(paperId, module)) ?? "";
}

export function writeDraft(
  paperId: string,
  module: ModuleId,
  value: string,
): void {
  if (value) browserStorage.writeRaw("local", draftKey(paperId, module), value);
  else browserStorage.removeRaw("local", draftKey(paperId, module));
}
