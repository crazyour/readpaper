"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlert,
  FileText,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  StartTurnMessage,
  StreamEvent,
} from "@/features/chat/model/protocol";
import { UnifiedTurnClient } from "@/features/chat/transport/UnifiedTurnClient";
import { useActiveWorkspaceId } from "@/hooks/useActiveWorkspaceId";
import { formatBytes } from "@/lib/doc-attachments";
import { extractBase64FromDataUrl, readFileAsDataUrl } from "@/lib/file-attachments";
import { upsertNotebookEntry } from "@/lib/notebook-api";
import {
  emptyAnswer,
  getUserAnswer,
  isAnswerCorrect,
  isAutoGradable,
  type LabAnswerState,
} from "@/lib/paper-quiz-grading";
import {
  QUIZ_QUESTION_TYPES,
  type NormalizedQuizQuestionType,
} from "@/lib/quiz-question-type";
import {
  extractQuizQuestions,
  extractQuizTurnId,
  extractStreamingQuizQuestions,
  QUIZ_TYPE_LABEL_KEYS,
  type QuizQuestion,
} from "@/lib/quiz-types";

import AgentTracePanel from "./AgentTracePanel";
import PaperQuizQuestionCard from "./PaperQuizQuestionCard";

const DIFFICULTIES = ["auto", "easy", "medium", "hard"] as const;

interface FollowupMessage {
  role: "user" | "assistant";
  text: string;
  /** Source ids the agent read while answering, for citation display. */
  sourceIds: string[];
}

/**
 * Paper Quiz Lab — a focused human/agent loop over one uploaded paper.
 *
 * 1. The learner uploads a PDF.
 * 2. The `deep_question` capability reads it and poses questions
 *    (exploring → planning → quizzing).
 * 3. The learner answers; results land in the question bank.
 * 4. The learner can then ask free-form questions about the same paper in
 *    the same session, where the `chat` capability reaches for the attached
 *    source through `read_source` and answers with citable source ids.
 */
export default function PaperQuizLab() {
  const { t } = useTranslation();
  const workspaceId = useActiveWorkspaceId();

  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("");
  const [numQuestions, setNumQuestions] = useState(3);
  const [difficulty, setDifficulty] = useState<string>("auto");
  const [types, setTypes] = useState<NormalizedQuizQuestionType[]>([]);
  const [dragging, setDragging] = useState(false);

  const [quizEvents, setQuizEvents] = useState<StreamEvent[]>([]);
  const [answers, setAnswers] = useState<Record<string, LabAnswerState>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);

  const [followupMessages, setFollowupMessages] = useState<FollowupMessage[]>([]);
  const [followupDraft, setFollowupDraft] = useState("");

  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const clientRef = useRef<UnifiedTurnClient | null>(null);
  const phaseRef = useRef<"quiz" | "followup">("quiz");
  const followupBufferRef = useRef<{ text: string; sourceIds: string[] }>({
    text: "",
    sourceIds: [],
  });

  const handleEvent = useCallback((event: StreamEvent) => {
    if (phaseRef.current === "quiz") {
      setQuizEvents((prev) => [...prev, event]);
    } else {
      if (event.type === "content" && event.content) {
        followupBufferRef.current.text += event.content;
      }
      const sourceId = event.metadata?.source_id;
      if (typeof sourceId === "string" && sourceId.trim()) {
        const id = sourceId.trim();
        if (!followupBufferRef.current.sourceIds.includes(id)) {
          followupBufferRef.current.sourceIds.push(id);
        }
      }
      setFollowupMessages((prev) => [...prev]); // keep the list stable
    }

    if (event.session_id) setSessionId(event.session_id);
    if (event.turn_id) setTurnId(event.turn_id);
    if (event.type === "error") setError(event.content || t("Unknown error"));
    if (event.type === "done") {
      setBusy(false);
      if (phaseRef.current === "followup") {
        const buffer = followupBufferRef.current;
        followupBufferRef.current = { text: "", sourceIds: [] };
        setFollowupMessages((prev) => [
          ...prev,
          { role: "assistant", text: buffer.text, sourceIds: buffer.sourceIds },
        ]);
      }
    }
  }, [t]);

  useEffect(() => {
    const client = new UnifiedTurnClient(handleEvent, () => {
      setBusy(false);
      setConnected(false);
    });
    clientRef.current = client;
    client.connect();

    const poll = window.setInterval(() => {
      if (client.connected) {
        setConnected(true);
        window.clearInterval(poll);
      }
    }, 100);
    const giveUp = window.setTimeout(() => window.clearInterval(poll), 15_000);

    return () => {
      window.clearInterval(poll);
      window.clearTimeout(giveUp);
      client.disconnect();
      clientRef.current = null;
    };
  }, [handleEvent]);

  // Streamed questions arrive one at a time; the final result event is
  // authoritative once it lands. Derived during render — the event list is
  // the single source of truth.
  const questions = useMemo<QuizQuestion[]>(() => {
    const fromResult = extractQuizQuestions(
      quizEvents.find((e) => e.type === "result")?.metadata,
    );
    return fromResult ?? extractStreamingQuizQuestions(quizEvents) ?? [];
  }, [quizEvents]);

  const quizTurnId = useMemo(
    () => extractQuizTurnId(quizEvents),
    [quizEvents],
  );

  const pickFile = useCallback((candidate: File | undefined) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".pdf")) {
      setError(t("Only PDF files are supported here."));
      return;
    }
    setError("");
    setFile(candidate);
    setAnswers({});
    setQuizEvents([]);
    setFollowupMessages([]);
  }, [t]);

  async function generate() {
    const client = clientRef.current;
    if (!client || !file || busy) return;

    setError("");
    setBusy(true);
    phaseRef.current = "quiz";
    setQuizEvents([]);
    setAnswers({});
    setFollowupMessages([]);

    let base64 = "";
    try {
      base64 = extractBase64FromDataUrl(await readFileAsDataUrl(file));
    } catch {
      setError(t("Could not read the uploaded file."));
      setBusy(false);
      return;
    }

    const payload: StartTurnMessage = {
      type: "start_turn",
      content: topic.trim(),
      capability: "deep_question",
      workspace_id: workspaceId || null,
      config: {
        mode: "custom",
        topic: topic.trim(),
        num_questions: numQuestions,
        difficulty: difficulty === "auto" ? "" : difficulty,
        question_types: types,
        per_type_counts: {},
      },
      attachments: [
        {
          type: "pdf",
          filename: file.name,
          base64,
          mime_type: "application/pdf",
        },
      ],
    };
    client.send(payload);
  }

  async function submitAnswer(question: QuizQuestion, index: number) {
    const key = question.question_id || String(index);
    const answer = answers[key];
    const targetTurnId = quizTurnId ?? turnId;
    if (!answer || !sessionId || !targetTurnId) return;
    const gradable = isAutoGradable(question);
    try {
      await upsertNotebookEntry({
        session_id: sessionId,
        turn_id: targetTurnId,
        question_id: question.question_id,
        question: question.question,
        question_type: question.question_type,
        options: question.options ?? {},
        correct_answer: question.correct_answer,
        explanation: question.explanation ?? "",
        difficulty: question.difficulty ?? "",
        user_answer: getUserAnswer(question, answer),
        is_correct: gradable ? isAnswerCorrect(question, answer) : undefined,
      });
    } catch {
      setError(t("Could not save this answer to the question bank."));
    }
  }

  function sendFollowup() {
    const client = clientRef.current;
    const text = followupDraft.trim();
    if (!client || !text || busy) return;

    setError("");
    setBusy(true);
    phaseRef.current = "followup";
    followupBufferRef.current = { text: "", sourceIds: [] };
    setFollowupMessages((prev) => [
      ...prev,
      { role: "user", text, sourceIds: [] },
    ]);
    setFollowupDraft("");

    const payload: StartTurnMessage = {
      type: "start_turn",
      content: text,
      capability: "chat",
      session_id: sessionId,
      workspace_id: workspaceId || null,
    };
    client.send(payload);
  }

  const answeredCount = useMemo(
    () => Object.values(answers).filter((a) => a.submitted).length,
    [answers],
  );

  const toggleType = (value: NormalizedQuizQuestionType) => {
    setTypes((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col gap-4 p-4 lg:flex-row">
      {/* ── Left: upload + configuration ─────────────────────────── */}
      <section className="flex w-full shrink-0 flex-col gap-4 lg:w-[320px]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h1 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <FileText size={16} className="text-[var(--primary)]" />
            {t("Paper Quiz Lab")}
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            {t(
              "Upload a paper, let the agent pose questions about it, then answer and follow up.",
            )}
          </p>

          <label
            htmlFor="paper-quiz-file"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              pickFile(event.dataTransfer.files?.[0]);
            }}
            className={[
              "mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition",
              dragging
                ? "border-[var(--primary)] bg-[var(--primary)]/10"
                : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--primary)]/60",
            ].join(" ")}
          >
            <Upload size={18} className="text-[var(--muted-foreground)]" />
            {file ? (
              <>
                <span className="max-w-full truncate text-xs font-medium text-[var(--foreground)]">
                  {file.name}
                </span>
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {formatBytes(file.size)}
                </span>
              </>
            ) : (
              <>
                <span className="text-xs font-medium text-[var(--foreground)]">
                  {t("Drop a PDF here, or click to browse")}
                </span>
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {t("The paper is parsed locally, then read by the agent.")}
                </span>
              </>
            )}
            <input
              id="paper-quiz-file"
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
          </label>

          {file ? (
            <button
              type="button"
              onClick={() => setFile(null)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <Trash2 size={11} />
              {t("Remove")}
            </button>
          ) : null}

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                {t("Focus topic (optional)")}
              </span>
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder={t("e.g. the method section's main claim")}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                {t("Number of questions")}: {numQuestions}
              </span>
              <input
                type="range"
                min={1}
                max={10}
                value={numQuestions}
                onChange={(event) => setNumQuestions(Number(event.target.value))}
                className="w-full accent-[var(--primary)]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                {t("Difficulty")}
              </span>
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                {DIFFICULTIES.map((value) => (
                  <option key={value} value={value}>
                    {t(
                      value === "auto"
                        ? "Auto"
                        : value === "easy"
                          ? "Easy"
                          : value === "medium"
                            ? "Medium"
                            : "Hard",
                    )}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">
                {t("Question types")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {QUIZ_QUESTION_TYPES.map((value) => {
                  const active = types.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleType(value)}
                      className={[
                        "rounded-full border px-2.5 py-1 text-[10px] transition",
                        active
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                          : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50",
                      ].join(" ")}
                    >
                      {t(QUIZ_TYPE_LABEL_KEYS[value])}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                {t("Leave all unselected to let the planner decide.")}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={!file || busy}
            onClick={() => void generate()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {t("Ask the agent about this paper")}
          </button>

          {!connected ? (
            <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
              {t("Connecting to the agent runtime…")}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Middle: questions + follow-up ─────────────────────────── */}
      <section className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          {error ? (
            <p className="flex items-start gap-2 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}

          {questions.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
              <Sparkles size={22} className="text-[var(--muted-foreground)]" />
              <p className="text-xs text-[var(--muted-foreground)]">
                {busy
                  ? t("The agent is reading the paper…")
                  : t("Upload a paper and let the agent pose questions about it.")}
              </p>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {t("Questions")} · {answeredCount}/{questions.length}{" "}
                {t("answered")}
              </p>
              {questions.map((question, index) => {
                const key = question.question_id || String(index);
                const answer = answers[key] ?? emptyAnswer();
                return (
                  <PaperQuizQuestionCard
                    key={key}
                    question={question}
                    index={index}
                    total={questions.length}
                    answer={answer}
                    onChange={(next) =>
                      setAnswers((prev) => ({ ...prev, [key]: next }))
                    }
                    onSubmit={() => {
                      setAnswers((prev) => ({
                        ...prev,
                        [key]: { ...answer, submitted: true },
                      }));
                      void submitAnswer(question, index);
                    }}
                  />
                );
              })}
            </>
          )}
        </div>

        {/* Follow-up chat — same session, so the agent can read the paper
            through `read_source` and answer with citable source ids. */}
        <div className="flex shrink-0 flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
            <MessageSquare size={13} className="text-[var(--primary)]" />
            {t("Follow up on this paper")}
          </h2>

          {followupMessages.length > 0 ? (
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {followupMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={[
                    "rounded-lg px-3 py-2 text-xs leading-relaxed",
                    message.role === "user"
                      ? "ml-auto max-w-[85%] bg-[var(--primary)]/10 text-[var(--foreground)]"
                      : "max-w-[95%] bg-[var(--background)] text-[var(--foreground)]",
                  ].join(" ")}
                >
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {message.sourceIds.length > 0 ? (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                      {t("Read from")}:
                      {message.sourceIds.map((id) => (
                        <span
                          key={id}
                          className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono"
                        >
                          {id}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <textarea
              value={followupDraft}
              disabled={!sessionId || busy}
              onChange={(event) => setFollowupDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendFollowup();
                }
              }}
              rows={2}
              placeholder={
                sessionId
                  ? t("Ask a question about the paper…")
                  : t("Generate questions first to unlock follow-ups.")
              }
              className="flex-1 resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!followupDraft.trim() || busy || !sessionId}
              onClick={sendFollowup}
              className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Right: agent trace ───────────────────────────────────── */}
      <section className="w-full shrink-0 lg:w-[340px]">
        <AgentTracePanel events={quizEvents} running={busy} />
      </section>
    </div>
  );
}
