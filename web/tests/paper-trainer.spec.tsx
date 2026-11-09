import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ModuleId,
  ModuleState,
  PaperState,
  RoundState,
} from "@/features/paper-trainer/model";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// ----- a small, stateful stand-in for the trainer API ----------------------

function freshModule(module: ModuleId, question: string): ModuleState {
  return {
    module,
    current_question: question,
    current_focus: "",
    pending_question: "",
    pending_focus: "",
    hint: "",
    hint_evidence: [],
    rounds: [],
    summary: null,
    finished: false,
  };
}

function freshPaper(): PaperState {
  return {
    paper_id: "p1",
    filename: "plan.pdf",
    title: "Contact graphs for function prediction",
    source_url: "",
    outline: {
      title: "",
      research_question: "",
      related_work: "",
      research_gap: "",
      objective: "",
      methods: [],
      pipeline: "",
      experiments: "",
      results: "",
      limitations: "",
      sections: [],
    },
    modules: {
      framing: freshModule("framing", "Why does this gap matter?"),
      implementation: freshModule("implementation", "How is the graph built?"),
    },
    created_at: 0,
    updated_at: 0,
  };
}

function grade(state: ModuleState, module: ModuleId, answer: string): ModuleState {
  const question = state.current_question;
  const next = `Follow-up ${state.rounds.length + 1} (${module})`;
  const feedback = {
    correct: ["You named the gap."],
    gaps: ["You did not say why it persists."],
    reasoning: ["Without that, necessity does not follow."],
    hints: ["Look at the paragraph after related work."],
    understanding: "partial" as const,
    evidence: [
      { section: "1 Introduction", quote: "No method predicts function.", page: null, basis: "stated" as const },
    ],
    next_question: {
      question: next,
      focus: "deeper",
      rationale: "",
      evidence: [],
    },
  };

  const rounds = [...state.rounds];
  const last = rounds[rounds.length - 1];
  if (last && last.question === question) {
    const revisions =
      last.answer && last.answer !== answer
        ? [...last.revisions, last.answer]
        : last.revisions;
    rounds[rounds.length - 1] = { ...last, answer, revisions, feedback };
  } else {
    const round: RoundState = {
      index: rounds.length,
      question,
      focus: "",
      answer,
      revisions: [],
      feedback,
      evidence: feedback.evidence,
      created_at: 0,
      updated_at: 0,
    };
    rounds.push(round);
  }

  return { ...state, rounds, pending_question: next, pending_focus: "deeper" };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let paper: PaperState;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  const method = (init?.method ?? "GET").toUpperCase();

  if (method === "POST" && /\/api\/paper-trainer\/papers(?:\?|$)/.test(url)) {
    paper = freshPaper();
    return json(paper);
  }

  if (method === "GET" && url.includes("/api/paper-trainer/papers/p1")) {
    return json(paper);
  }

  const match = url.match(
    /\/api\/paper-trainer\/papers\/p1\/modules\/(framing|implementation)\/(answer|advance|hint|summary)/,
  );
  if (!match) return json({ detail: "Not found" }, 404);

  const moduleId = match[1] as ModuleId;
  const action = match[2];
  const current = paper.modules[moduleId] as ModuleState;

  if (action === "answer") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { answer?: string };
    paper = {
      ...paper,
      modules: {
        ...paper.modules,
        [moduleId]: grade(current, moduleId, body.answer ?? ""),
      },
    };
  } else if (action === "advance") {
    paper = {
      ...paper,
      modules: {
        ...paper.modules,
        [moduleId]: {
          ...current,
          current_question: current.pending_question,
          pending_question: "",
        },
      },
    };
  } else if (action === "hint") {
    paper = {
      ...paper,
      modules: {
        ...paper.modules,
        [moduleId]: { ...current, hint: "Re-read section 1." },
      },
    };
  } else {
    // summary
    paper = {
      ...paper,
      modules: {
        ...paper.modules,
        [moduleId]: {
          ...current,
          summary: {
            mastered: ["the gap"],
            gaps: ["why the gap persists"],
            misconceptions: [],
            reread: ["1 Introduction"],
            narrative: "You have the shape; the causal step is missing.",
          },
        },
      },
    };
  }

  return json(paper.modules[moduleId]);
});

import PaperTrainerLab from "@/components/paper-trainer/PaperTrainerLab";

beforeEach(() => {
  paper = freshPaper();
  vi.stubGlobal("fetch", fetchMock);
});

async function upload() {
  render(<PaperTrainerLab />);
  const input = (await screen.findByTestId(
    "paper-trainer-file",
  )) as HTMLInputElement;
  fireEvent.change(input, {
    target: {
      files: [new File(["paper"], "plan.pdf", { type: "application/pdf" })],
    },
  });
}

function column(module: ModuleId): HTMLElement {
  return screen.getByTestId(`column-${module}`);
}

async function answer(module: ModuleId, text: string) {
  const input = screen.getByTestId(`answer-input-${module}`) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByTestId(`submit-${module}`));
  await waitFor(() =>
    expect(
      within(column(module)).getAllByTestId("feedback-card").length,
    ).toBeGreaterThan(0),
  );
}

describe("paper trainer", () => {
  it("opens both modules on upload, each with its own question", async () => {
    await upload();

    expect(await screen.findByTestId("column-framing")).toBeInTheDocument();
    expect(screen.getByTestId("column-implementation")).toBeInTheDocument();
    expect(screen.getByTestId("question-framing")).toHaveTextContent(
      "Why does this gap matter?",
    );
    expect(screen.getByTestId("question-implementation")).toHaveTextContent(
      "How is the graph built?",
    );
  });

  it("keeps the other module untouched when one is answered", async () => {
    await upload();
    await screen.findByTestId("column-framing");

    const right = screen.getByTestId(
      "answer-input-implementation",
    ) as HTMLTextAreaElement;
    fireEvent.change(right, { target: { value: "a draft on the right" } });

    await answer("framing", "Because the gap is real.");

    expect(screen.getByTestId("question-implementation")).toHaveTextContent(
      "How is the graph built?",
    );
    expect(
      (screen.getByTestId("answer-input-implementation") as HTMLTextAreaElement)
        .value,
    ).toBe("a draft on the right");
    expect(
      within(column("implementation")).queryAllByTestId("feedback-card"),
    ).toHaveLength(0);
  });

  it("revises the same round instead of opening a new one", async () => {
    await upload();
    await screen.findByTestId("column-framing");

    await answer("framing", "First attempt.");
    fireEvent.click(screen.getByTestId("revise-framing"));

    const input = screen.getByTestId("answer-input-framing") as HTMLTextAreaElement;
    expect(input.value).toBe("First attempt.");

    fireEvent.change(input, { target: { value: "Second attempt." } });
    fireEvent.click(screen.getByTestId("submit-framing"));

    await waitFor(() =>
      expect(
        within(column("framing")).getAllByTestId("feedback-card"),
      ).toHaveLength(1),
    );
    expect(
      within(column("framing")).getByText("Earlier versions: {{count}}"),
    ).toBeInTheDocument();
  });

  it("only moves to the next question when asked to continue", async () => {
    await upload();
    await screen.findByTestId("column-framing");

    await answer("framing", "An answer.");
    expect(screen.getByTestId("question-framing")).toHaveTextContent(
      "Why does this gap matter?",
    );

    fireEvent.click(screen.getByTestId("advance-framing"));

    await waitFor(() =>
      expect(screen.getByTestId("question-framing")).toHaveTextContent(
        "Follow-up 1 (framing)",
      ),
    );
  });

  it("keeps earlier rounds collapsed until the student opens them", async () => {
    await upload();
    await screen.findByTestId("column-framing");

    await answer("framing", "First round answer.");
    fireEvent.click(screen.getByTestId("advance-framing"));
    await waitFor(() =>
      expect(screen.getByTestId("question-framing")).toHaveTextContent(
        "Follow-up 1 (framing)",
      ),
    );
    await answer("framing", "Second round answer.");

    expect(within(column("framing")).queryAllByTestId("history-round")).toHaveLength(
      0,
    );

    fireEvent.click(screen.getByTestId("history-toggle-framing"));
    await waitFor(() =>
      expect(
        within(column("framing")).getAllByTestId("history-round").length,
      ).toBe(1),
    );
  });

  it("restores both modules after a reload", async () => {
    const answered = grade(
      freshPaper().modules.framing as ModuleState,
      "framing",
      "An earlier answer.",
    );
    paper = {
      ...freshPaper(),
      modules: {
        framing: answered,
        implementation: freshImplementationAfterAdvance(),
      },
    };
    localStorage.setItem("deeptutor:v2:paper-trainer:last-paper", "p1");

    render(<PaperTrainerLab />);

    expect(await screen.findByTestId("column-framing")).toBeInTheDocument();
    expect(screen.getByTestId("question-framing")).toHaveTextContent(
      "Why does this gap matter?",
    );
    expect(screen.getByTestId("question-implementation")).toHaveTextContent(
      "A different question on the implementation side?",
    );
    expect(
      within(column("framing")).getAllByTestId("feedback-card").length,
    ).toBe(1);
  });
});

function freshImplementationAfterAdvance(): ModuleState {
  return freshModule(
    "implementation",
    "A different question on the implementation side?",
  );
}
