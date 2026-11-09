"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Lightbulb,
  PencilLine,
  Send,
  Workflow,
  X,
} from "lucide-react";

import FeedbackCard from "./FeedbackCard";
import InlineText from "./InlineText";
import SummaryPanel from "./SummaryPanel";
import { Button, InlineAlert } from "@/shared/ui";
import {
  advanceModule,
  requestHint,
  requestSummary,
  submitAnswer,
} from "@/features/paper-trainer/client";
import { readDraft, writeDraft } from "@/features/paper-trainer/drafts";
import {
  answeredRound,
  earlierRounds,
  type ModuleId,
  type ModuleState,
  type PaperEvidence,
  type RoundState,
} from "@/features/paper-trainer/model";

type Busy = "answer" | "hint" | "advance" | "summary" | null;

const MODULE_ICON = {
  framing: Compass,
  implementation: Workflow,
} as const;

/** A quiet row that opens a section of the column. */
function SectionToggle({
  label,
  meta,
  open,
  onClick,
  testId,
}: {
  label: string;
  meta?: string;
  open: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      data-testid={testId}
      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 motion-reduce:transition-none"
    >
      <span className="flex items-baseline gap-1.5">
        {label}
        {meta ? (
          <span className="text-[11px] tabular-nums text-muted-foreground/70">
            {meta}
          </span>
        ) : null}
      </span>
      {open ? (
        <ChevronDown size={13} className="shrink-0" />
      ) : (
        <ChevronRight size={13} className="shrink-0" />
      )}
    </button>
  );
}

function HistoryRound({
  round,
  expanded,
  onToggle,
  onViewPaper,
}: {
  round: RoundState;
  expanded: boolean;
  onToggle: () => void;
  onViewPaper: (evidence?: PaperEvidence[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="history-round"
        className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 motion-reduce:transition-none"
      >
        <span className="mt-px flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
          {String(round.index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-card-foreground">
            {round.question}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
            {round.answer}
          </span>
        </span>
        {expanded ? (
          <ChevronDown
            size={13}
            className="mt-1 shrink-0 text-muted-foreground"
          />
        ) : (
          <ChevronRight
            size={13}
            className="mt-1 shrink-0 text-muted-foreground"
          />
        )}
      </button>
      {expanded ? (
        <div className="border-t border-border/70 bg-muted/20 px-3 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("Your answer")}
          </p>
          <p className="mt-1 max-w-[68ch] whitespace-pre-wrap text-[12.5px] leading-[1.7] text-card-foreground">
            {round.answer}
          </p>
          {round.feedback ? (
            <FeedbackCard
              feedback={round.feedback}
              onViewEvidence={onViewPaper}
              className="mt-3 bg-card"
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * One training module: its own question, draft, feedback and history.
 *
 * Nothing here reads or writes the other module's state. The parent swaps in a
 * new `ModuleState` when a call returns, so a submit on one side can never
 * touch the question, draft or history of the other.
 */
export default function TrainingColumn({
  paperId,
  module,
  state,
  title,
  goal,
  language,
  onUpdate,
  onViewPaper,
}: {
  paperId: string;
  module: ModuleId;
  state: ModuleState;
  title: string;
  goal: string;
  language: string;
  onUpdate: (state: ModuleState) => void;
  onViewPaper: (evidence?: PaperEvidence[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => readDraft(paperId, module));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [revising, setRevising] = useState(false);
  const [draftBeforeRevision, setDraftBeforeRevision] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const round = answeredRound(state);
  const history = earlierRounds(state);
  const answeredCount = state.rounds.filter(
    (item) => item.answer.trim().length > 0,
  ).length;
  const Icon = MODULE_ICON[module];

  const updateDraft = useCallback(
    (value: string) => {
      setDraft(value);
      writeDraft(paperId, module, value);
    },
    [paperId, module],
  );

  const run = useCallback(
    async (kind: Exclude<Busy, null>, action: () => Promise<ModuleState>) => {
      setBusy(kind);
      setError("");
      try {
        onUpdate(await action());
      } catch (cause) {
        const message =
          cause instanceof Error && cause.message.trim()
            ? cause.message
            : t("Something went wrong. Please try again.");
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [onUpdate, t],
  );

  const handleSubmit = () => {
    const answer = draft.trim();
    if (!answer || busy) return;
    void run("answer", async () => {
      const next = await submitAnswer(paperId, module, answer, language);
      updateDraft("");
      setRevising(false);
      return next;
    });
  };

  const startRevision = () => {
    if (!round) return;
    setDraftBeforeRevision(draft);
    setRevising(true);
    updateDraft(round.answer);
  };

  const cancelRevision = () => {
    setRevising(false);
    updateDraft(draftBeforeRevision);
  };

  const showComposer = !round || revising;

  return (
    <section
      data-testid={`column-${module}`}
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card"
    >
      <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-snug text-card-foreground">
            {title}
          </h2>
          <p className="mt-0.5 max-w-[46ch] text-[12px] leading-[1.6] text-muted-foreground">
            {goal}
          </p>
        </div>
        <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {t("Rounds answered: {{count}}", { count: answeredCount })}
        </span>
      </header>

      <div className="flex flex-col gap-4 px-5 py-4">
        {state.current_question ? (
          <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("Current question")}
            </p>
            <p
              data-testid={`question-${module}`}
              className="mt-2 max-w-[52ch] font-serif text-[16.5px] leading-[1.7] text-card-foreground"
            >
              <InlineText text={state.current_question} />
            </p>
          </div>
        ) : null}

        {showComposer ? (
          <>
            <div>
              <label
                htmlFor={`answer-${module}`}
                className="text-[11.5px] font-medium text-muted-foreground"
              >
                {revising ? t("Revising your earlier answer") : t("Your answer")}
              </label>
              <textarea
                id={`answer-${module}`}
                data-testid={`answer-input-${module}`}
                value={draft}
                onChange={(event) => updateDraft(event.target.value)}
                rows={6}
                placeholder={t(
                  "Write what you think the paper argues, then check it against the text.",
                )}
                className="mt-1.5 min-h-[132px] w-full resize-y rounded-xl border border-border bg-background px-3.5 py-3 text-[13.5px] leading-[1.7] text-foreground outline-none placeholder:text-muted-foreground/80 transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 motion-reduce:transition-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleSubmit}
                loading={busy === "answer"}
                disabled={!draft.trim() || (busy !== null && busy !== "answer")}
                icon={<Send size={13} />}
                data-testid={`submit-${module}`}
              >
                {t("Submit answer")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void run("hint", () => requestHint(paperId, module, language))
                }
                loading={busy === "hint"}
                disabled={busy !== null && busy !== "hint"}
                icon={<Lightbulb size={13} />}
                data-testid={`hint-button-${module}`}
              >
                {t("Get a hint")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onViewPaper(state.hint_evidence)}
                icon={<FileText size={13} />}
              >
                {t("View the paper")}
              </Button>
              {revising ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelRevision}
                  icon={<X size={13} />}
                >
                  {t("Cancel")}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}

        {round && !revising ? (
          <>
            <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                {t("Your answer")}
              </p>
              <p className="mt-1.5 max-w-[68ch] whitespace-pre-wrap text-[13px] leading-[1.7] text-card-foreground">
                {round.answer}
              </p>
              {round.revisions.length ? (
                <details className="mt-2.5">
                  <summary className="cursor-pointer text-[11.5px] text-muted-foreground underline-offset-2 hover:underline">
                    {t("Earlier versions: {{count}}", {
                      count: round.revisions.length,
                    })}
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {round.revisions.map((version, index) => (
                      <li
                        key={index}
                        className="max-w-[68ch] whitespace-pre-wrap rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[12px] leading-[1.7] text-muted-foreground"
                      >
                        {version}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>

            {round.feedback ? (
              <FeedbackCard
                feedback={round.feedback}
                onViewEvidence={onViewPaper}
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {state.finished && !state.pending_question ? (
                <p className="max-w-[60ch] text-[12px] leading-[1.7] text-muted-foreground">
                  {t(
                    "This module has no further question. The summary is always here.",
                  )}
                </p>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    void run("advance", () => advanceModule(paperId, module))
                  }
                  loading={busy === "advance"}
                  icon={<ArrowRight size={13} />}
                  data-testid={`advance-${module}`}
                >
                  {t("Continue with the next question")}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={startRevision}
                icon={<PencilLine size={13} />}
                data-testid={`revise-${module}`}
              >
                {t("Revise this answer")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onViewPaper(round.evidence)}
                icon={<BookOpen size={13} />}
              >
                {t("Show in paper")}
              </Button>
            </div>
          </>
        ) : null}

        {state.hint ? (
          <div
            data-testid={`hint-${module}`}
            className="rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-3"
          >
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-primary">
              <Lightbulb size={12} />
              {t("Hint")}
            </p>
            <p className="mt-1.5 max-w-[68ch] text-[12.5px] leading-[1.7] text-card-foreground">
              <InlineText text={state.hint} />
            </p>
            {state.hint_evidence.length ? (
              <button
                type="button"
                onClick={() => onViewPaper(state.hint_evidence)}
                className="mt-2 cursor-pointer rounded-sm text-[11.5px] font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 motion-reduce:transition-none"
              >
                {t("Show in paper")}
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

        {history.length ? (
          <div className="border-t border-border/70 pt-2">
            <SectionToggle
              label={t("Earlier rounds")}
              meta={`(${history.length})`}
              open={historyOpen}
              onClick={() => setHistoryOpen((value) => !value)}
              testId={`history-toggle-${module}`}
            />
            {historyOpen ? (
              <ol className="mt-2 space-y-2">
                {history.map((item) => (
                  <HistoryRound
                    key={item.index}
                    round={item}
                    expanded={expandedRound === item.index}
                    onToggle={() =>
                      setExpandedRound((current) =>
                        current === item.index ? null : item.index,
                      )
                    }
                    onViewPaper={onViewPaper}
                  />
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-border/70 pt-2">
          <SectionToggle
            label={t("Learning summary")}
            open={summaryOpen}
            onClick={() => setSummaryOpen((value) => !value)}
            testId={`summary-toggle-${module}`}
          />
          {summaryOpen ? (
            <div className="mt-2">
              <SummaryPanel
                summary={state.summary}
                busy={busy === "summary"}
                onRefresh={() =>
                  void run("summary", () =>
                    requestSummary(paperId, module, language),
                  )
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
