"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Wrench,
} from "lucide-react";
import {
  buildAgentTrace,
  summarizeAgentResult,
  type AgentTrace,
} from "@/lib/paper-quiz-trace";
import type { StreamEvent } from "@/features/chat/model/protocol";

function stageLabel(stage: string): string {
  switch (stage) {
    case "exploring":
      return "Exploring";
    case "planning":
      return "Planning";
    case "quizzing":
      return "Questioning";
    case "attachment_parsing":
      return "Parsing PDF";
    default:
      return stage || "unknown";
  }
}

/**
 * Shows the learner what the agent actually did: which pipeline stages ran,
 * which tools it reached for, how the PDF was parsed, and what the final
 * result payload contained.
 */
export default function AgentTracePanel({
  events,
  running,
}: {
  events: StreamEvent[];
  running: boolean;
}) {
  const { t } = useTranslation();

  const trace: AgentTrace = useMemo(() => buildAgentTrace(events), [events]);
  const result = useMemo(
    () => summarizeAgentResult(trace.resultPayload),
    [trace.resultPayload],
  );

  const eventSummary = useMemo(
    () =>
      Object.entries(trace.eventCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
    [trace.eventCounts],
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <header className="flex items-center gap-2">
        <Activity size={16} className="text-[var(--primary)]" />
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          {t("Agent activity")}
        </h2>
        {running ? (
          <span className="ml-auto rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
            {t("running")}
          </span>
        ) : null}
      </header>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          {t("Pipeline stages")}
        </h3>
        {trace.stages.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("No stage has started yet.")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {trace.stages.map((stage) => (
              <li
                key={stage.name}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5"
              >
                {stage.status === "done" ? (
                  <CircleCheck
                    size={14}
                    className="shrink-0 text-[var(--primary)]"
                  />
                ) : stage.status === "active" ? (
                  <CircleDot
                    size={14}
                    className="shrink-0 animate-pulse text-[var(--primary)]"
                  />
                ) : (
                  <CircleDashed
                    size={14}
                    className="shrink-0 text-[var(--muted-foreground)]"
                  />
                )}
                <span className="text-xs text-[var(--foreground)]">
                  {t(stageLabel(stage.name))}
                </span>
                <span className="ml-auto font-mono text-[10px] text-[var(--muted-foreground)]">
                  {stage.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          {t("Tools called")}
        </h3>
        {trace.tools.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("The agent has not called any tool yet.")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {trace.tools.map((tool) => (
              <li
                key={tool.name}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <Wrench
                    size={12}
                    className="shrink-0 text-[var(--muted-foreground)]"
                  />
                  <span className="font-mono text-[11px] text-[var(--foreground)]">
                    {tool.name}
                  </span>
                  {tool.count > 1 ? (
                    <span className="rounded bg-[var(--muted)] px-1.5 text-[10px] text-[var(--muted-foreground)]">
                      ×{tool.count}
                    </span>
                  ) : null}
                  {tool.sourceId ? (
                    <span className="ml-auto font-mono text-[10px] text-[var(--primary)]">
                      {tool.sourceId}
                    </span>
                  ) : null}
                </div>
                {tool.lastDetail ? (
                  <p className="mt-1 break-words text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                    {tool.lastDetail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {trace.attachmentPhases.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {t("PDF parsing")}
          </h3>
          <ul className="space-y-1">
            {trace.attachmentPhases.map((phase, index) => (
              <li
                key={`${phase.phase}-${index}`}
                className="flex items-start gap-2 text-[11px] text-[var(--muted-foreground)]"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                <span>
                  <span className="font-mono text-[var(--foreground)]">
                    {phase.phase || "—"}
                  </span>
                  {phase.message ? ` · ${phase.message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {t("Result payload")}
          </h3>
          <dl className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
              <dt className="text-[var(--muted-foreground)]">{t("Requested")}</dt>
              <dd className="text-sm font-semibold text-[var(--foreground)]">
                {result.requested}
              </dd>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
              <dt className="text-[var(--muted-foreground)]">{t("Generated")}</dt>
              <dd className="text-sm font-semibold text-[var(--foreground)]">
                {result.completed}
                {result.failed > 0 ? (
                  <span className="ml-1 text-[var(--destructive)]">
                    ({result.failed} {t("failed")})
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
          {result.analysis ? (
            <p className="mt-2 break-words text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              {result.analysis}
            </p>
          ) : null}
        </div>
      ) : null}

      {eventSummary.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {t("Stream events")}
          </h3>
          <div className="flex flex-wrap gap-1">
            {eventSummary.map(([type, count]) => (
              <span
                key={type}
                className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted-foreground)]"
              >
                {type} ×{count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {trace.error ? (
        <p className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-2.5 py-2 text-[11px] text-[var(--destructive)]">
          {trace.error}
        </p>
      ) : null}
    </section>
  );
}
