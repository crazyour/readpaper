"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Lightbulb,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComponentType } from "react";

import { StatusChip, cn } from "@/shared/ui";
import InlineText from "./InlineText";
import type {
  EvidenceBasis,
  PaperEvidence,
  RoundFeedback,
  Understanding,
} from "@/features/paper-trainer/model";

const UNDERSTANDING_LABEL: Record<Understanding, string> = {
  incorrect: "Understanding: not yet",
  partial: "Understanding: partly there",
  correct: "Understanding: on track",
  mastered: "Understanding: grasped",
};

const UNDERSTANDING_TONE: Record<
  Understanding,
  "danger" | "warning" | "success"
> = {
  incorrect: "danger",
  partial: "warning",
  correct: "success",
  mastered: "success",
};

/** The colour a grading result lends the card's edge. */
const UNDERSTANDING_RULE: Record<Understanding, string> = {
  incorrect: "before:bg-destructive",
  partial: "before:bg-warning",
  correct: "before:bg-success",
  mastered: "before:bg-success",
};

const BASIS_LABEL: Record<EvidenceBasis, string> = {
  stated: "Stated by the authors",
  inferred: "Inferred from the paper",
  extension: "Beyond the paper",
};

const BASIS_TONE: Record<EvidenceBasis, "neutral" | "info" | "warning"> = {
  stated: "neutral",
  inferred: "info",
  extension: "warning",
};

type GroupKey = "correct" | "gaps" | "reasoning" | "hints";

const GROUP_STYLE: Record<
  GroupKey,
  {
    icon: ComponentType<{ size?: number | string; className?: string }>;
    tile: string;
    label: string;
  }
> = {
  correct: {
    icon: CheckCircle2,
    tile: "bg-success-surface text-success-foreground",
    label: "text-success-foreground",
  },
  gaps: {
    icon: AlertCircle,
    tile: "bg-warning-surface text-warning-foreground",
    label: "text-warning-foreground",
  },
  reasoning: {
    icon: ArrowRight,
    tile: "bg-info-surface text-info-foreground",
    label: "text-info-foreground",
  },
  hints: {
    icon: Lightbulb,
    tile: "bg-primary/10 text-primary",
    label: "text-primary",
  },
};

function Group({
  kind,
  title,
  items,
}: {
  kind: GroupKey;
  title: string;
  items: string[];
}) {
  if (!items.length) return null;
  const style = GROUP_STYLE[kind];
  const Icon = style.icon;
  return (
    <section>
      <h4 className="flex items-center gap-2 text-[12px] font-medium">
        <span
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px]",
            style.tile,
          )}
        >
          <Icon size={11} />
        </span>
        <span className={style.label}>{title}</span>
      </h4>
      <ul className="mt-2 space-y-1.5 pl-[26px]">
        {items.map((item, index) => (
          <li
            key={`${index}-${item}`}
            className="max-w-[68ch] text-[13px] leading-[1.75] text-card-foreground/90 before:mr-2 before:text-muted-foreground/60 before:content-['·']"
          >
            <InlineText text={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceItem({ item }: { item: PaperEvidence }) {
  const { t } = useTranslation();
  const basis: EvidenceBasis = item.basis in BASIS_LABEL ? item.basis : "stated";
  return (
    <li className="rounded-lg border border-border/70 bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip tone={BASIS_TONE[basis]}>{t(BASIS_LABEL[basis])}</StatusChip>
        {item.section ? (
          <span className="text-[11.5px] font-medium text-card-foreground">
            {item.section}
          </span>
        ) : null}
        {item.page !== null && item.page !== undefined ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t("Page {{page}}", { page: item.page })}
          </span>
        ) : null}
      </div>
      {item.quote ? (
        <blockquote className="mt-2 max-w-[68ch] border-l-2 border-primary/35 pl-2.5 font-serif text-[13px] italic leading-[1.7] text-muted-foreground">
          {item.quote}
        </blockquote>
      ) : null}
    </li>
  );
}

/**
 * One grading result: what landed, what did not, why that matters, and what to
 * think about next — plus the passages it rests on.
 *
 * The card is the tutor's voice, so it reads as a document: a coloured edge for
 * the verdict, a quiet four-part structure, and quotes set in the paper's own
 * type. The next question is deliberately absent — the column decides when to
 * open it, so a student can revise first.
 */
export default function FeedbackCard({
  feedback,
  onViewEvidence,
  className = "",
}: {
  feedback: RoundFeedback;
  onViewEvidence?: (evidence: PaperEvidence[]) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const understanding: Understanding =
    feedback.understanding in UNDERSTANDING_LABEL
      ? feedback.understanding
      : "partial";

  return (
    <section
      data-testid="feedback-card"
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        UNDERSTANDING_RULE[understanding],
        className,
      )}
    >
      <StatusChip tone={UNDERSTANDING_TONE[understanding]}>
        {t(UNDERSTANDING_LABEL[understanding])}
      </StatusChip>

      <div className="mt-3.5 space-y-3.5">
        <Group
          kind="correct"
          title={t("What you got right")}
          items={feedback.correct}
        />
        <Group
          kind="gaps"
          title={t("What is missing or wrong")}
          items={feedback.gaps}
        />
        <Group
          kind="reasoning"
          title={t("Why it matters")}
          items={feedback.reasoning}
        />
        <Group
          kind="hints"
          title={t("What to think about next")}
          items={feedback.hints}
        />
      </div>

      {feedback.evidence.length ? (
        <div className="mt-4 border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              <FileText size={12} />
              {t("Evidence in the paper")}
            </h4>
            {onViewEvidence ? (
              <button
                type="button"
                onClick={() => onViewEvidence(feedback.evidence)}
                className="cursor-pointer rounded-sm text-[11.5px] font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 motion-reduce:transition-none"
              >
                {t("Show in paper")}
              </button>
            ) : null}
          </div>
          <ul className="mt-2 space-y-2">
            {feedback.evidence.map((item, index) => (
              <EvidenceItem key={`${index}-${item.section}`} item={item} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
