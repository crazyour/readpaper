"use client";

import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui";
import InlineText from "./InlineText";
import type { ModuleSummary } from "@/features/paper-trainer/model";

type Tone = "success" | "warning" | "destructive" | "info";

const DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

function List({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: Tone;
}) {
  if (!items.length) return null;
  return (
    <div className="min-w-0">
      <h4 className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
        {title}
      </h4>
      <ul className="mt-1.5 space-y-1 pl-3">
        {items.map((item, index) => (
          <li
            key={`${index}-${item}`}
            className="max-w-[52ch] text-[12.5px] leading-[1.7] text-card-foreground/90 before:mr-1.5 before:text-muted-foreground/50 before:content-['–']"
          >
            <InlineText text={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Where the student stands in this module — derived from the round history, so
 * it can never contradict what the tutor already said.
 */
export default function SummaryPanel({
  summary,
  busy = false,
  onRefresh,
}: {
  summary: ModuleSummary | null;
  busy?: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const empty =
    !summary ||
    (!summary.mastered.length &&
      !summary.gaps.length &&
      !summary.misconceptions.length &&
      !summary.reread.length &&
      !summary.narrative);

  return (
    <section
      data-testid="summary-panel"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-card-foreground">
          {t("Learning summary")}
        </h3>
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={onRefresh}
          icon={<RefreshCw size={12} />}
        >
          {t("Refresh summary")}
        </Button>
      </div>

      {empty ? (
        <p className="mt-2 max-w-[60ch] text-[12.5px] leading-[1.7] text-muted-foreground">
          {t("No summary yet. Answer one question first.")}
        </p>
      ) : (
        <div className="mt-3 space-y-3.5">
          {summary.narrative ? (
            <p className="max-w-[68ch] font-serif text-[13.5px] leading-[1.75] text-card-foreground">
              <InlineText text={summary.narrative} />
            </p>
          ) : null}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <List
              title={t("Mastered")}
              items={summary.mastered}
              tone="success"
            />
            <List
              title={t("Still unclear")}
              items={summary.gaps}
              tone="warning"
            />
            <List
              title={t("Misconceptions")}
              items={summary.misconceptions}
              tone="destructive"
            />
            <List
              title={t("Reread in the paper")}
              items={summary.reread}
              tone="info"
            />
          </div>
        </div>
      )}
    </section>
  );
}
