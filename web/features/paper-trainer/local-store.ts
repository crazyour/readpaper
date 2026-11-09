/** Local persistence for the serverless paper trainer. */

import { browserStorage } from "@/shared/storage";

import type { ModuleId, ModuleState, PaperState } from "./model";

const NAMESPACE = "deeptutor:v3:paper-trainer:paper:";
const memory = new Map<string, StoredPaper>();

interface StoredPaper {
  version: 1;
  paper: PaperState;
  paperText: string;
}

function storageKey(paperId: string): string {
  return `${NAMESPACE}${paperId}`;
}

function persistedCopy(value: StoredPaper): StoredPaper {
  return {
    ...value,
    paper: { ...value.paper, source_url: "" },
  };
}

export function savePaperSession(paper: PaperState, paperText: string): void {
  const stored: StoredPaper = { version: 1, paper, paperText };
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
    const parsed = JSON.parse(raw) as Partial<StoredPaper>;
    if (
      parsed.version !== 1 ||
      !parsed.paper ||
      parsed.paper.paper_id !== paperId ||
      typeof parsed.paperText !== "string"
    ) {
      return null;
    }
    const restored = parsed as StoredPaper;
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
  savePaperSession(paper, stored.paperText);
  return paper;
}
