"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  GraduationCap,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";

import TrainingColumn from "./TrainingColumn";
import OriginalPaperPanel from "./OriginalPaperPanel";
import { Button, InlineAlert } from "@/shared/ui";
import {
  MAX_UPLOAD_BYTES,
  getPaper,
  isSupportedPaper,
  uploadPaper,
} from "@/features/paper-trainer/client";
import {
  readLastPaperId,
  writeLastPaperId,
} from "@/features/paper-trainer/drafts";
import {
  MODULE_IDS,
  type ModuleId,
  type ModuleState,
  type PaperDifficulty,
  type PaperEvidence,
  type PaperState,
} from "@/features/paper-trainer/model";

const MODULE_TITLE: Record<ModuleId, string> = {
  framing: "Research framing",
  implementation: "Research implementation",
};

const MODULE_GOAL: Record<ModuleId, string> = {
  framing: "Work out why this research had to be done.",
  implementation: "Work out how the research was done, and why that way.",
};

const DIFFICULTY_OPTIONS: ReadonlyArray<{
  value: PaperDifficulty;
  label: string;
  description: string;
}> = [
  {
    value: "beginner",
    label: "Beginner",
    description: "Focuses on the main idea and explains necessary terms.",
  },
  {
    value: "research",
    label: "Research background",
    description: "Challenges methods, evidence, and research design.",
  },
  {
    value: "domain",
    label: "Research + domain background",
    description: "Probes domain assumptions, novelty, and technical trade-offs.",
  },
];

function paperEvidence(paper: PaperState): PaperEvidence[] {
  const collected: PaperEvidence[] = [];
  const seen = new Set<string>();
  for (const state of Object.values(paper.modules)) {
    if (!state) continue;
    const groups = [
      state.hint_evidence,
      ...state.rounds.flatMap((round) => [
        round.evidence,
        round.feedback?.evidence ?? [],
      ]),
    ];
    for (const item of groups.flat()) {
      if (!item.section && !item.quote) continue;
      const key = `${item.section}\u0000${item.quote}\u0000${item.page ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
    }
  }
  return collected;
}

/**
 * The paper this browser was last working on.
 *
 * A paper that no longer exists simply means a fresh start: the saved id is
 * dropped rather than surfaced as an error.
 */
async function restoreLastPaper(): Promise<PaperState | null> {
  const paperId = readLastPaperId();
  if (!paperId) return null;
  try {
    return await getPaper(paperId);
  } catch {
    writeLastPaperId("");
    return null;
  }
}

function UploadArea({
  busy,
  busySeconds,
  dragging,
  selectedFile,
  difficulty,
  onPick,
  onDragState,
  onDifficultyChange,
  onStart,
}: {
  busy: boolean;
  busySeconds: number;
  dragging: boolean;
  selectedFile: File | null;
  difficulty: PaperDifficulty;
  onPick: (file: File | null | undefined) => void;
  onDragState: (dragging: boolean) => void;
  onDifficultyChange: (difficulty: PaperDifficulty) => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const busyMessage =
    busySeconds < 3
      ? t("Extracting the paper text…")
      : busySeconds < 10
        ? t("Reading and structuring the paper…")
        : busySeconds < 25
          ? t("Preparing both opening questions…")
          : t("Still working…");
  if (selectedFile) {
    return (
      <div className="mx-auto w-full max-w-3xl py-8 sm:py-12">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex min-w-0 items-center gap-3 border-b border-border/70 pb-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText aria-hidden size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {t("Selected paper")}
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-card-foreground">
                {selectedFile.name}
              </p>
            </div>
          </div>

          <fieldset className="mt-6" disabled={busy}>
            <legend className="font-serif text-lg font-semibold text-card-foreground">
              {t("Choose question difficulty")}
            </legend>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {DIFFICULTY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={[
                    "relative flex min-h-28 cursor-pointer flex-col rounded-xl border p-4 transition-colors motion-reduce:transition-none",
                    difficulty === option.value
                      ? "border-primary bg-primary/[0.06] ring-1 ring-primary/20"
                      : "border-border bg-background hover:border-primary/40",
                    busy ? "cursor-not-allowed opacity-60" : "",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="paper-difficulty"
                    value={option.value}
                    checked={difficulty === option.value}
                    onChange={() => onDifficultyChange(option.value)}
                    className="peer sr-only"
                  />
                  <span className="text-sm font-semibold text-foreground peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-4 peer-focus-visible:ring-offset-card">
                    {t(option.label)}
                  </span>
                  <span className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {t(option.description)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="md" loading={busy} onClick={onStart}>
              {busy ? busyMessage : t("Start paper questions")}
            </Button>
            <label
              htmlFor="paper-trainer-file-replace"
              className="inline-flex min-h-10 cursor-pointer items-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-within:ring-2 focus-within:ring-ring"
            >
              {t("Choose a different file")}
              <input
                id="paper-trainer-file-replace"
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="sr-only"
                disabled={busy}
                onChange={(event) => onPick(event.target.files?.[0])}
              />
            </label>
          </div>
          {busy ? (
            <p
              className="mt-3 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {busyMessage}
              {busySeconds >= 5 ? (
                <span aria-hidden className="ml-1 tabular-nums">
                  {busySeconds}s
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-xl py-10 sm:py-16">
      <label
        htmlFor="paper-trainer-file"
        onDragOver={(event) => {
          event.preventDefault();
          onDragState(true);
        }}
        onDragLeave={() => onDragState(false)}
        onDrop={(event) => {
          event.preventDefault();
          onDragState(false);
          onPick(event.dataTransfer.files?.[0]);
        }}
        className={[
          "flex cursor-pointer flex-col items-center gap-4 rounded-2xl border border-dashed px-8 py-12 text-center shadow-sm transition-colors motion-reduce:transition-none sm:py-14",
          dragging
            ? "border-primary bg-primary/[0.05]"
            : "border-border bg-card hover:border-primary/50",
        ].join(" ")}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {busy ? (
            <Loader2 size={20} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Upload size={20} />
          )}
        </span>

        <div>
          <p className="font-serif text-[19px] font-medium leading-snug text-card-foreground">
            {busy
              ? t("Reading the paper and opening both modules…")
              : t("Drop a PDF here, or click to browse")}
          </p>
        </div>

        <span className="rounded-full border border-border/80 px-3 py-1 text-[11px] text-muted-foreground">
          {t("PDF, Word, Markdown or plain text.")}
        </span>

        <input
          id="paper-trainer-file"
          data-testid="paper-trainer-file"
          type="file"
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          disabled={busy}
          onChange={(event) => onPick(event.target.files?.[0])}
        />
      </label>
    </div>
  );
}

/**
 * Paper study trainer — two independent Socratic interviews over one paper.
 *
 * The page owns the paper and the original-file panel. Each column owns its
 * own module: question, draft, feedback, history and summary. Because the
 * server keeps a row per (paper, module), a reload restores both columns
 * exactly where the student left them.
 *
 * The route renders without the app shell (see `lib/chromeless-routes`), so
 * this header is the only chrome the student sees.
 */
export default function PaperTrainerLab() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language || "en").split("-")[0] || "en";

  const [paper, setPaper] = useState<PaperState | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadSeconds, setUploadSeconds] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [difficulty, setDifficulty] = useState<PaperDifficulty>("research");

  const [originalOpen, setOriginalOpen] = useState(false);
  const [originalEvidence, setOriginalEvidence] = useState<PaperEvidence[]>([]);
  const restoreStarted = useRef(false);

  // Restore the paper the student was last working on.
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    let cancelled = false;
    void restoreLastPaper().then((state) => {
      if (cancelled) return;
      if (state) setPaper(state);
      setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!uploading) {
      setUploadSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(
      () => setUploadSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [uploading]);

  const handlePick = useCallback(
    (file: File | null | undefined) => {
      if (!file || uploading) return;
      if (!isSupportedPaper(file)) {
        setError(
          t("Only PDF, Word, Markdown and plain-text papers are supported."),
        );
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(t("This file is too large. Please choose a smaller paper."));
        return;
      }
      setError("");
      setSelectedFile(file);
    },
    [t, uploading],
  );

  const startPaper = useCallback(() => {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setError("");
    uploadPaper(selectedFile, language, difficulty)
        .then((state) => {
          setPaper(state);
          setSelectedFile(null);
          writeLastPaperId(state.paper_id);
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error && cause.message.trim()
              ? cause.message
              : t("The paper could not be prepared. Please try again."),
          );
        })
        .finally(() => setUploading(false));
  }, [difficulty, language, selectedFile, t, uploading]);

  const handleModuleUpdate = useCallback(
    (module: ModuleId, next: ModuleState) => {
      setPaper((current) =>
        current
          ? {
              ...current,
              modules: { ...current.modules, [module]: next },
            }
          : current,
      );
    },
    [],
  );

  const openPaper = useCallback((evidence?: PaperEvidence[]) => {
    setOriginalEvidence(evidence ?? []);
    setOriginalOpen(true);
  }, []);

  const startOver = () => {
    setPaper(null);
    setSelectedFile(null);
    setError("");
    writeLastPaperId("");
  };

  const modules = paper
    ? MODULE_IDS.map(
        (module) => [module, paper.modules[module]] as const,
      ).filter((entry): entry is readonly [ModuleId, ModuleState] =>
        Boolean(entry[1]),
      )
    : [];
  const activeDifficulty = paper
    ? DIFFICULTY_OPTIONS.find((option) => option.value === paper.difficulty)
    : null;

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-5 py-6 lg:px-8 lg:py-8">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-primary">
              <GraduationCap size={17} />
            </span>
            <div className="min-w-0">
              <h1 className="font-serif text-[21px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
                {t("Paper Study Trainer")}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <FileText size={12} className="shrink-0" />
                <span className="truncate">
                  {paper
                    ? paper.title || paper.filename
                    : t("Upload a paper to begin.")}
                </span>
                {activeDifficulty ? (
                  <span className="shrink-0 rounded-full border border-border/80 px-2 py-0.5 text-[10.5px] font-medium text-foreground">
                    {t(activeDifficulty.label)}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {paper ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openPaper(paperEvidence(paper))}
                icon={<FileText size={13} />}
                data-testid="view-original"
              >
                {t("View original")}
              </Button>
            ) : null}
            {paper ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={startOver}
                icon={<RefreshCw size={13} />}
                data-testid="start-over"
              >
                {t("Upload a different paper")}
              </Button>
            ) : null}
          </div>
        </header>

        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

        {restoring ? (
          <p className="flex items-center gap-2 py-12 text-[12.5px] text-muted-foreground">
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
            {t("Loading your paper…")}
          </p>
        ) : null}

        {!restoring && !paper ? (
          <UploadArea
            busy={uploading}
            busySeconds={uploadSeconds}
            dragging={dragging}
            selectedFile={selectedFile}
            difficulty={difficulty}
            onPick={handlePick}
            onDragState={setDragging}
            onDifficultyChange={setDifficulty}
            onStart={startPaper}
          />
        ) : null}

        {paper && modules.length ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {modules.map(([module, state]) => (
              <TrainingColumn
                key={`${paper.paper_id}-${module}`}
                paperId={paper.paper_id}
                module={module}
                state={state}
                title={t(MODULE_TITLE[module])}
                goal={t(MODULE_GOAL[module])}
                language={language}
                onUpdate={(next) => handleModuleUpdate(module, next)}
                onViewPaper={openPaper}
              />
            ))}
          </div>
        ) : null}
      </div>

      {paper ? (
        <OriginalPaperPanel
          open={originalOpen}
          onClose={() => setOriginalOpen(false)}
          title={paper.title}
          sourceUrl={paper.source_url}
          filename={paper.filename}
          evidence={originalEvidence}
        />
      ) : null}
    </div>
  );
}
