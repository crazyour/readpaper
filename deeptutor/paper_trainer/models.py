"""Structured payloads for the paper-reading trainer.

The trainer's contract with the frontend is deliberately structured: every
turn returns the same shape, so the UI can render a feedback card without
knowing anything about how the answer was produced.

Three kinds of object cross the wire:

* :class:`PaperOutline` — what the parser found in the paper (research
  question, prior work, methods, experiments). It grounds every question and
  every piece of evidence, and it is produced once per paper.
* :class:`RoundFeedback` — the result of grading one student answer: the four
  feedback sections, the evidence the grader cited, and the next question.
* :class:`ModuleSummary` — the standing state of one training module: what
  the student has mastered, what is still missing, and which parts of the
  paper to reread.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: The two training modules. Their ids are part of the URL contract and of
#: the store's primary key, so they never change.
ModuleId = Literal["framing", "implementation"]

#: How well the student understood the question that was put to them.
Understanding = Literal["incorrect", "partial", "correct", "mastered"]


class PaperEvidence(BaseModel):
    """A passage of the paper that supports a claim.

    ``section`` names the part of the paper (``"3.2 Method"``), and ``quote``
    is a short excerpt from it. ``page`` is filled in only when the parser
    could locate the passage reliably — the trainer never invents one.
    """

    model_config = ConfigDict(extra="forbid")

    section: str = Field(default="", max_length=300)
    quote: str = Field(default="", max_length=1200)
    page: int | None = None
    #: What this passage shows — stated by the author, inferred from the
    #: paper, or a question the AI is raising beyond it.
    basis: Literal["stated", "inferred", "extension"] = "stated"


class PaperOutline(BaseModel):
    """What the paper says, distilled once so every question can cite it."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=500)
    #: The research question(s) the paper poses.
    research_question: str = Field(default="", max_length=2000)
    #: What prior work the paper builds on.
    related_work: str = Field(default="", max_length=3000)
    #: The gap the paper claims to fill.
    research_gap: str = Field(default="", max_length=2000)
    #: What the paper sets out to achieve.
    objective: str = Field(default="", max_length=2000)
    #: The methods, techniques and theories the paper uses.
    methods: list[str] = Field(default_factory=list)
    #: How the method works, step by step.
    pipeline: str = Field(default="", max_length=3000)
    #: How the paper validates its method.
    experiments: str = Field(default="", max_length=3000)
    #: What the experiments showed.
    results: str = Field(default="", max_length=3000)
    #: The limitations the paper admits to.
    limitations: str = Field(default="", max_length=2000)
    #: Section headings, used to point the student back into the paper.
    sections: list[str] = Field(default_factory=list)


class NextQuestion(BaseModel):
    """The next question the trainer will ask, and why it asks it."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(default="", max_length=1200)
    #: The knowledge point this question probes.
    focus: str = Field(default="", max_length=300)
    #: Why the trainer picked this question now.
    rationale: str = Field(default="", max_length=800)
    evidence: list[PaperEvidence] = Field(default_factory=list)


class RoundFeedback(BaseModel):
    """The grading of one student answer."""

    model_config = ConfigDict(extra="forbid")

    #: ① What the student got right.
    correct: list[str] = Field(default_factory=list)
    #: ② What the student got wrong or left out.
    gaps: list[str] = Field(default_factory=list)
    #: ③ Why those gaps matter.
    reasoning: list[str] = Field(default_factory=list)
    #: ④ What to think about next.
    hints: list[str] = Field(default_factory=list)
    understanding: Understanding = "partial"
    evidence: list[PaperEvidence] = Field(default_factory=list)
    #: The next question, absent when the module is finished.
    next_question: NextQuestion | None = None


class ModuleSummary(BaseModel):
    """The standing learning state of one module."""

    model_config = ConfigDict(extra="forbid")

    mastered: list[str] = Field(default_factory=list)
    #: Knowledge points the student still gets wrong or cannot state.
    gaps: list[str] = Field(default_factory=list)
    #: Misconceptions worth correcting.
    misconceptions: list[str] = Field(default_factory=list)
    #: Sections of the paper to reread.
    reread: list[str] = Field(default_factory=list)
    #: A short prose summary of where the student stands.
    narrative: str = Field(default="", max_length=4000)


class RoundState(BaseModel):
    """One question/answer/feedback triple inside a module."""

    model_config = ConfigDict(extra="forbid")

    index: int = 0
    question: str = ""
    focus: str = ""
    #: The student's current answer. Revisions keep the earlier ones.
    answer: str = ""
    #: Every earlier version of the answer, oldest first.
    revisions: list[str] = Field(default_factory=list)
    feedback: RoundFeedback | None = None
    evidence: list[PaperEvidence] = Field(default_factory=list)
    created_at: float = 0.0
    updated_at: float = 0.0


class ModuleState(BaseModel):
    """One module's complete, independent state."""

    model_config = ConfigDict(extra="forbid")

    module: ModuleId
    #: The question the student is answering right now. It stays put while the
    #: student revises an answer: the trainer only moves on when asked to.
    current_question: str = ""
    current_focus: str = ""
    #: The question the trainer suggests next, held back until the student is
    #: ready to move on. This is what makes a revision possible after feedback.
    pending_question: str = ""
    pending_focus: str = ""
    #: A hint already given for the current question, if any.
    hint: str = ""
    #: The passages a hint points at, so the UI can show where to look.
    hint_evidence: list[PaperEvidence] = Field(default_factory=list)
    rounds: list[RoundState] = Field(default_factory=list)
    summary: ModuleSummary | None = None
    #: True once the trainer has no further question for this module.
    finished: bool = False


class PaperState(BaseModel):
    """A paper and both of its modules — the whole restore payload."""

    model_config = ConfigDict(extra="forbid")

    paper_id: str
    filename: str = ""
    title: str = ""
    #: The URL the original file can be fetched from.
    source_url: str = ""
    outline: PaperOutline = Field(default_factory=PaperOutline)
    modules: dict[str, ModuleState] = Field(default_factory=dict)
    created_at: float = 0.0
    updated_at: float = 0.0


__all__ = [
    "ModuleId",
    "ModuleState",
    "ModuleSummary",
    "NextQuestion",
    "PaperEvidence",
    "PaperOutline",
    "PaperState",
    "RoundFeedback",
    "RoundState",
    "Understanding",
]
