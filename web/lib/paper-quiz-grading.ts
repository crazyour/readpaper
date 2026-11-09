/**
 * Answer state + grading for the Paper Quiz Lab.
 *
 * Mirrors the grading rules the chat quiz card uses
 * (``components/quiz/QuizViewer.tsx``): choice / concept / fill-in-the-blank
 * are auto-gradable by exact match, open-ended types are left for the learner
 * to compare against the reference answer.
 */

import {
  isChoiceQuizQuestion,
  isConceptQuizQuestion,
  isFillInBlankQuizQuestion,
  resolveChoiceAnswerKey,
  resolveConceptAnswer,
} from "@/lib/quiz-question-type";
import type { QuizQuestion } from "@/lib/quiz-types";

export interface LabAnswerState {
  /** Option key for choice questions; "true"/"false" for concept ones. */
  selected: string;
  /** Free text for fill-in-the-blank and open-ended questions. */
  typed: string;
  submitted: boolean;
}

export function emptyAnswer(): LabAnswerState {
  return { selected: "", typed: "", submitted: false };
}

export function isMultipleChoice(question: QuizQuestion): boolean {
  return (
    isChoiceQuizQuestion(question.question_type) &&
    !!question.options &&
    Object.keys(question.options).length > 0
  );
}

export function isAutoGradable(question: QuizQuestion): boolean {
  return (
    isMultipleChoice(question) ||
    isConceptQuizQuestion(question.question_type) ||
    isFillInBlankQuizQuestion(question.question_type)
  );
}

export function getUserAnswer(
  question: QuizQuestion,
  answer: LabAnswerState,
): string {
  if (
    isMultipleChoice(question) ||
    isConceptQuizQuestion(question.question_type)
  ) {
    return answer.selected ?? "";
  }
  return answer.typed.trim();
}

export function isAnswerCorrect(
  question: QuizQuestion,
  answer: LabAnswerState,
): boolean {
  const userAnswer = getUserAnswer(question, answer);
  if (!userAnswer) return false;
  const correct = (question.correct_answer ?? "").trim();
  if (isMultipleChoice(question)) {
    const correctChoiceKey = resolveChoiceAnswerKey(correct, question.options);
    return (
      userAnswer.toUpperCase() === correctChoiceKey ||
      userAnswer.toUpperCase() === correct.toUpperCase() ||
      userAnswer.toUpperCase() === correct.charAt(0).toUpperCase()
    );
  }
  if (isConceptQuizQuestion(question.question_type)) {
    const correctTF = resolveConceptAnswer(correct);
    return userAnswer.toLowerCase() === correctTF;
  }
  return userAnswer.toLowerCase() === correct.toLowerCase();
}

/** The option letters a choice question offers, in display order. */
export function choiceOptions(
  question: QuizQuestion,
): { key: string; text: string }[] {
  const options = question.options ?? {};
  return Object.entries(options).map(([key, text]) => ({ key, text }));
}

/**
 * Map a backend difficulty value onto the translated label key.
 * The backend reports lowercase values ("easy"); the locale catalogue keeps
 * the capitalised spellings the rest of the UI already uses.
 */
export function difficultyLabelKey(value: string | undefined): string {
  switch ((value ?? "").trim().toLowerCase()) {
    case "easy":
      return "Easy";
    case "medium":
      return "Medium";
    case "hard":
      return "Hard";
    default:
      return "Auto";
  }
}
