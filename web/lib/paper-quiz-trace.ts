/**
 * Pure derivation of an agent-activity trace from a turn's stream events.
 *
 * The lab page shows the learner *how* the agent worked, not just what it
 * answered: which stages ran, which tools it reached for, what the
 * attachment parser did. Everything here is derived from the events the
 * server already emits — no extra backend round-trip.
 */

import type { StreamEvent } from "@/features/chat/model/protocol";

export type AgentStageStatus = "pending" | "active" | "done";

export interface AgentStageTrace {
  /** Raw stage name as the backend reported it ("exploring", "quizzing", …). */
  name: string;
  status: AgentStageStatus;
  startedAt?: number;
  endedAt?: number;
}

export interface AgentToolTrace {
  name: string;
  stage: string;
  /** How many times the agent called it in this turn. */
  count: number;
  /** Short preview of the last tool output. */
  lastDetail?: string;
  /**
   * The attached-source id this call resolved to, when the tool read one
   * (`read_source` returns `source_id`). It is the handle a citation in the
   * answer points back to.
   */
  sourceId?: string;
}

export interface AgentAttachmentPhase {
  phase: string;
  message: string;
  filename?: string;
}

export interface AgentTrace {
  stages: AgentStageTrace[];
  tools: AgentToolTrace[];
  attachmentPhases: AgentAttachmentPhase[];
  /** Count per event type, for the "what happened" summary. */
  eventCounts: Record<string, number>;
  /** The final `result` event metadata, if the turn produced one. */
  resultPayload?: Record<string, unknown>;
  /** The terminal error message, if the turn failed. */
  error?: string;
}

/** The order the deep_question pipeline runs its stages in. */
const STAGE_ORDER = ["exploring", "planning", "quizzing"];

function preview(text: string, limit = 120): string {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit)}…`;
}

function toolNameOf(event: StreamEvent): string {
  const meta = event.metadata ?? {};
  const name = meta.tool_name ?? meta.tool;
  if (typeof name === "string" && name.trim()) return name.trim();
  return (event.content || "").trim();
}

/**
 * Build the trace for one turn. Stage order follows the pipeline order when
 * the backend used the known stage names, so the panel reads top-to-bottom
 * the way the agent actually worked.
 */
export function buildAgentTrace(events: StreamEvent[]): AgentTrace {
  const stageMap = new Map<string, AgentStageTrace>();
  const toolMap = new Map<string, AgentToolTrace>();
  const attachmentPhases: AgentAttachmentPhase[] = [];
  const eventCounts: Record<string, number> = {};
  let resultPayload: Record<string, unknown> | undefined;
  let error: string | undefined;

  for (const event of events) {
    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;

    if (event.type === "stage_start" && event.stage) {
      const existing = stageMap.get(event.stage);
      if (existing) {
        existing.status = "active";
      } else {
        stageMap.set(event.stage, {
          name: event.stage,
          status: "active",
          startedAt: event.timestamp,
        });
      }
      continue;
    }

    if (event.type === "stage_end" && event.stage) {
      const existing = stageMap.get(event.stage);
      if (existing) {
        existing.status = "done";
        existing.endedAt = event.timestamp;
      } else {
        stageMap.set(event.stage, {
          name: event.stage,
          status: "done",
          endedAt: event.timestamp,
        });
      }
      continue;
    }

    if (event.type === "tool_call") {
      const name = toolNameOf(event);
      if (!name) continue;
      const existing = toolMap.get(name);
      if (existing) {
        existing.count += 1;
      } else {
        toolMap.set(name, {
          name,
          stage: event.stage || "",
          count: 1,
        });
      }
      continue;
    }

    if (event.type === "tool_result") {
      const name = toolNameOf(event);
      const existing = name ? toolMap.get(name) : undefined;
      if (existing) {
        existing.lastDetail = preview(event.content);
        const sourceId = event.metadata?.source_id;
        if (typeof sourceId === "string" && sourceId.trim()) {
          existing.sourceId = sourceId.trim();
        }
      }
      continue;
    }

    if (event.source === "attachment_parsing" && event.type === "progress") {
      attachmentPhases.push({
        phase: event.stage || "",
        message: preview(event.content, 200),
        filename:
          typeof event.metadata?.filename === "string"
            ? event.metadata.filename
            : undefined,
      });
      continue;
    }

    if (event.type === "result") {
      resultPayload = event.metadata ?? {};
      continue;
    }

    if (event.type === "error") {
      error = event.content || "unknown error";
    }
  }

  const stages = Array.from(stageMap.values()).sort((a, b) => {
    const ai = STAGE_ORDER.indexOf(a.name);
    const bi = STAGE_ORDER.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return (a.startedAt ?? 0) - (b.startedAt ?? 0);
  });

  const tools = Array.from(toolMap.values()).sort((a, b) => b.count - a.count);

  return { stages, tools, attachmentPhases, eventCounts, resultPayload, error };
}

/**
 * Pull the headline numbers out of a deep_question result payload so the
 * panel can show what the planner actually produced.
 */
export interface AgentResultSummary {
  requested: number;
  completed: number;
  failed: number;
  mode: string;
  analysis: string;
}

export function summarizeAgentResult(
  payload: Record<string, unknown> | undefined,
): AgentResultSummary | null {
  if (!payload) return null;
  const summary = payload.summary as Record<string, unknown> | undefined;
  if (!summary) return null;
  return {
    requested: Number(summary.requested ?? 0),
    completed: Number(summary.completed ?? 0),
    failed: Number(summary.failed ?? 0),
    mode: String(payload.mode ?? ""),
    analysis: String(summary.analysis ?? ""),
  };
}
