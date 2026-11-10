/** Local persistence for the serverless paper trainer. */

import { browserStorage } from "@/shared/storage";

import {
  normalizePaperDifficulty,
  type ModuleId,
  type ModuleState,
  type PaperState,
} from "./model";

const NAMESPACE = "deeptutor:v3:paper-trainer:paper:";
const memory = new Map<string, StoredPaper>();

export type PaperBackend =
  | { kind: "local" }
  | { kind: "cloud"; baseUrl: string };

export interface StoredPaper {
  version: 2;
  paper: PaperState;
  paperText: string;
  backend: PaperBackend;
}

function storageKey(paperId: string): string {
  return `${NAMESPACE}${paperId}`;
}

function persistedCopy(value: StoredPaper): StoredPaper {
  return {
    ...value,
    // Object URLs only survive in the current tab. A cloud URL is durable and
    // should remain available after a reload.
    paper: {
      ...value.paper,
      source_url: value.paper.source_url.startsWith("blob:")
        ? ""
        : value.paper.source_url,
    },
  };
}

export function savePaperSession(
  paper: PaperState,
  paperText: string,
  backend: PaperBackend = { kind: "local" },
): void {
  const stored: StoredPaper = { version: 2, paper, paperText, backend };
  memory.set(paper.paper_id, stored);
  browserStorage.writeRaw(
    "local",
    storageKey(paper.paper_id),
    JSON.stringify(persistedCopy(stored)),
  );
}

export function readPaperSession(paperId: string): StoredPaper | null {
  const live = memory.get(paperId);
  if (live) return live;
  const raw = browserStorage.readRaw("local", storageKey(paperId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      paper?: PaperState;
      paperText?: unknown;
      backend?: PaperBackend;
    };
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      !parsed.paper ||
      parsed.paper.paper_id !== paperId ||
      typeof parsed.paperText !== "string"
    ) {
      return null;
    }
    const restored: StoredPaper = {
      version: 2,
      paper: {
        ...parsed.paper,
        difficulty: normalizePaperDifficulty(parsed.paper.difficulty),
      },
      paperText: parsed.paperText,
      backend:
        parsed.version === 2 && parsed.backend?.kind === "cloud"
          ? parsed.backend
          : { kind: "local" },
    };
    memory.set(paperId, restored);
    return restored;
  } catch {
    return null;
  }
}

export function saveModuleState(
  paperId: string,
  module: ModuleId,
  state: ModuleState,
): PaperState {
  const stored = readPaperSession(paperId);
  if (!stored) {
    throw new Error("This paper is no longer available in this browser.");
  }
  const paper: PaperState = {
    ...stored.paper,
    modules: { ...stored.paper.modules, [module]: state },
    updated_at: Date.now() / 1000,
  };
  savePaperSession(paper, stored.paperText, stored.backend);
  return paper;
}
