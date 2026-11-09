/**
 * Wire types for the paper-reading trainer.
 *
 * These mirror `deeptutor/paper_trainer/models.py` exactly. The UI renders
 * them structurally — feedback is always four labelled groups plus evidence —
 * so nothing here assumes a particular question order.
 */

export type ModuleId = "framing" | "implementation";

export const MODULE_IDS: readonly ModuleId[] = ["framing", "implementation"];

export type Understanding = "incorrect" | "partial" | "correct" | "mastered";

/** Whether a passage states, implies, or goes beyond what the paper says. */
export type EvidenceBasis = "stated" | "inferred" | "extension";

export interface PaperEvidence {
  section: string;
  quote: string;
  page: number | null;
  basis: EvidenceBasis;
}

export interface NextQuestion {
  question: string;
  focus: string;
  rationale: string;
  evidence: PaperEvidence[];
}

export interface RoundFeedback {
  correct: string[];
  gaps: string[];
  reasoning: string[];
  hints: string[];
  understanding: Understanding;
  evidence: PaperEvidence[];
  next_question: NextQuestion | null;
}

export interface RoundState {
  index: number;
  question: string;
  focus: string;
  answer: string;
  /** Every earlier version of this answer, oldest first. */
  revisions: string[];
  feedback: RoundFeedback | null;
  evidence: PaperEvidence[];
  created_at: number;
  updated_at: number;
}

export interface ModuleSummary {
  mastered: string[];
  gaps: string[];
  misconceptions: string[];
  reread: string[];
  narrative: string;
}

export interface ModuleState {
  module: ModuleId;
  /** The question the student is answering now. */
  current_question: string;
  current_focus: string;
  /** The question waiting behind it, revealed when the student moves on. */
  pending_question: string;
  pending_focus: string;
  hint: string;
  hint_evidence: PaperEvidence[];
  rounds: RoundState[];
  summary: ModuleSummary | null;
  finished: boolean;
}

export interface PaperOutline {
  title: string;
  research_question: string;
  related_work: string;
  research_gap: string;
  objective: string;
  methods: string[];
  pipeline: string;
  experiments: string;
  results: string;
  limitations: string;
  sections: string[];
}

export interface PaperState {
  paper_id: string;
  filename: string;
  title: string;
  source_url: string;
  outline: PaperOutline;
  modules: Partial<Record<ModuleId, ModuleState>>;
  created_at: number;
  updated_at: number;
}

/** The round the student is currently working on, if it has been answered. */
export function answeredRound(state: ModuleState): RoundState | null {
  for (let i = state.rounds.length - 1; i >= 0; i -= 1) {
    const round = state.rounds[i];
    if (round.question === state.current_question && round.feedback) return round;
  }
  return null;
}

/** Earlier rounds, newest first, excluding the one shown above the history. */
export function earlierRounds(state: ModuleState): RoundState[] {
  const shown = answeredRound(state);
  return state.rounds
    .filter((round) => round !== shown && round.answer.trim().length > 0)
    .slice()
    .reverse();
}

export function hasEvidence(evidence: PaperEvidence[] | undefined): boolean {
  return Boolean(evidence && evidence.length > 0);
}
