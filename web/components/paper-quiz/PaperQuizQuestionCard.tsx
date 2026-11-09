"use client";

import { useTranslation } from "react-i18next";
import { Check, CircleHelp, X } from "lucide-react";
import {
  choiceOptions,
  difficultyLabelKey,
  getUserAnswer,
  isAnswerCorrect,
  isAutoGradable,
  isMultipleChoice,
  type LabAnswerState,
} from "@/lib/paper-quiz-grading";
import { QUIZ_TYPE_LABEL_KEYS, type QuizQuestion } from "@/lib/quiz-types";

export default function PaperQuizQuestionCard({
  question,
  index,
  total,
  answer,
  onChange,
  onSubmit,
  disabled,
}: {
  question: QuizQuestion;
  index: number;
  total: number;
  answer: LabAnswerState;
  onChange: (next: LabAnswerState) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const choice = isMultipleChoice(question);
  const concept = question.question_type === "concept";
  const gradable = isAutoGradable(question);
  const userAnswer = getUserAnswer(question, answer);
  const canSubmit = userAnswer.length > 0;
  const correct = answer.submitted && gradable ? isAnswerCorrect(question, answer) : null;

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
          {index + 1} / {total}
        </span>
        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
          {t(QUIZ_TYPE_LABEL_KEYS[question.question_type] ?? "Question")}
        </span>
        {question.difficulty ? (
          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
            {t(difficultyLabelKey(question.difficulty))}
          </span>
        ) : null}
        {question.concentration ? (
          <span className="truncate text-[10px] text-[var(--muted-foreground)]">
            · {question.concentration}
          </span>
        ) : null}
      </header>

      <p className="mb-3 text-sm leading-relaxed text-[var(--foreground)]">
        {question.question}
      </p>

      {choice ? (
        <div className="space-y-1.5">
          {choiceOptions(question).map((option) => {
            const picked = answer.selected === option.key;
            const revealed = answer.submitted;
            const isKey =
              revealed &&
              (option.key.toUpperCase() ===
                (question.correct_answer ?? "").trim().toUpperCase() ||
                option.key.toUpperCase() ===
                  (question.correct_answer ?? "").trim().charAt(0).toUpperCase());
            return (
              <button
                key={option.key}
                type="button"
                disabled={disabled || revealed}
                onClick={() => onChange({ ...answer, selected: option.key })}
                className={[
                  "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition",
                  "disabled:cursor-not-allowed",
                  revealed && isKey
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                    : revealed && picked
                      ? "border-[var(--destructive)] bg-[var(--destructive)]/10 text-[var(--foreground)]"
                      : picked
                        ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--foreground)]"
                        : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--primary)]/50",
                ].join(" ")}
              >
                <span className="font-mono font-semibold">{option.key}</span>
                <span className="flex-1">{option.text}</span>
                {revealed && isKey ? (
                  <Check size={13} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                ) : null}
                {revealed && picked && !isKey ? (
                  <X size={13} className="mt-0.5 shrink-0 text-[var(--destructive)]" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : concept ? (
        <div className="flex gap-2">
          {[
            { key: "true", label: t("True") },
            { key: "false", label: t("False") },
          ].map((option) => {
            const picked = answer.selected === option.key;
            const revealed = answer.submitted;
            const isKey = revealed && option.key === (question.correct_answer ?? "").toLowerCase();
            return (
              <button
                key={option.key}
                type="button"
                disabled={disabled || revealed}
                onClick={() => onChange({ ...answer, selected: option.key })}
                className={[
                  "rounded-lg border px-4 py-1.5 text-xs transition disabled:cursor-not-allowed",
                  revealed && isKey
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                    : revealed && picked
                      ? "border-[var(--destructive)] bg-[var(--destructive)]/10 text-[var(--foreground)]"
                      : picked
                        ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--foreground)]"
                        : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--primary)]/50",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <textarea
          value={answer.typed}
          disabled={disabled || answer.submitted}
          onChange={(event) => onChange({ ...answer, typed: event.target.value })}
          rows={3}
          placeholder={t("Type your answer")}
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
        />
      )}

      {!answer.submitted ? (
        <button
          type="button"
          disabled={!canSubmit || disabled}
          onClick={onSubmit}
          className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("Submit answer")}
        </button>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
          {gradable ? (
            <p
              className={[
                "flex items-center gap-1.5 text-xs font-medium",
                correct
                  ? "text-[var(--primary)]"
                  : "text-[var(--destructive)]",
              ].join(" ")}
            >
              {correct ? <Check size={13} /> : <X size={13} />}
              {correct ? t("Correct") : t("Not quite")}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              <CircleHelp size={13} />
              {t("Compare your answer with the reference below.")}
            </p>
          )}
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {t("Reference answer")}:{" "}
            <span className="text-[var(--foreground)]">
              {question.correct_answer}
            </span>
          </p>
          {question.explanation ? (
            <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              {question.explanation}
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}
