"""Tests for the paper-reading trainer.

The behaviours worth pinning down are the ones the product depends on:

* the two training modules of one paper never share state;
* a round keeps every version of the student's answer;
* the grader's output is parsed into structured feedback, and a malformed
  payload costs the round its decoration but not its answer;
* the store survives a reload, which is what "refresh the page and carry on"
  means.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from deeptutor.paper_trainer import grader
from deeptutor.paper_trainer.models import (
    ModuleState,
    ModuleSummary,
    NextQuestion,
    PaperEvidence,
    PaperOutline,
    RoundFeedback,
    RoundState,
)
from deeptutor.paper_trainer.service import (
    PaperTrainerError,
    advance_module,
    create_paper,
    refresh_summary,
    request_hint,
    submit_answer,
)
from deeptutor.paper_trainer.store import MODULES, PaperTrainerStore


@pytest.fixture()
def store(tmp_path: Path) -> PaperTrainerStore:
    return PaperTrainerStore(tmp_path / "trainer.sqlite3")


def _outline() -> PaperOutline:
    return PaperOutline(
        title="Graph neural networks for protein function prediction",
        research_question="Can contact graphs predict protein function without high-quality structures?",
        related_work="Sequence models ignore structure; structure models need high-quality folds.",
        research_gap="No method uses predicted contact graphs for function prediction.",
        objective="Build a GAT-based predictor over AlphaFold contact graphs.",
        methods=["Graph attention network", "AlphaFold contact graphs"],
        pipeline="Predict contacts, build a graph, train a GAT, evaluate on held-out proteins.",
        experiments="Ablations on dataset size, graph construction and architecture.",
        results="The GAT baseline beats the sequence baseline on function prediction.",
        limitations="Only evaluated on one dataset; no wet-lab validation.",
        sections=["1 Introduction", "2 Related Work", "3 Method", "4 Experiments"],
    )


def _paper(store: PaperTrainerStore) -> str:
    store.upsert_paper(
        paper_id="p1",
        filename="plan.pdf",
        title="A plan",
        source_url="/files/paper-trainer/p1/source/plan.pdf",
        outline=_outline(),
    )
    for module in MODULES:
        store.save_module(
            "p1",
            ModuleState(
                module=module,
                current_question=f"What is the {module} question?",
                current_focus=f"{module} focus",
            ),
        )
    return "p1"


# ----- store --------------------------------------------------------------


def test_store_round_trips_a_paper(store: PaperTrainerStore) -> None:
    _paper(store)
    loaded = store.get_paper("p1")
    assert loaded is not None
    assert loaded.title == "A plan"
    assert loaded.outline.research_gap.startswith("No method")
    assert set(loaded.modules) == set(MODULES)


def test_the_two_modules_are_stored_separately(store: PaperTrainerStore) -> None:
    _paper(store)
    framing = store.get_module("p1", "framing")
    implementation = store.get_module("p1", "implementation")
    assert framing is not None and implementation is not None

    framing.current_question = "framing changed"
    framing.rounds.append(RoundState(question="q", answer="a"))
    store.save_module("p1", framing)

    # The other module is untouched by the first module's write.
    other = store.get_module("p1", "implementation")
    assert other is not None
    assert other.current_question == "What is the implementation question?"
    assert not other.rounds


def test_a_paper_survives_a_reopen(tmp_path: Path) -> None:
    path = tmp_path / "trainer.sqlite3"
    first = PaperTrainerStore(path)
    _paper(first)
    first.save_module(
        "p1",
        ModuleState(module="framing", current_question="kept?", current_focus="f"),
    )

    second = PaperTrainerStore(path)
    restored = second.get_module("p1", "framing")
    assert restored is not None
    assert restored.current_question == "kept?"


def test_unknown_paper_is_none(store: PaperTrainerStore) -> None:
    assert store.get_paper("nope") is None
    assert store.get_module("nope", "framing") is None


# ----- grading ------------------------------------------------------------


def _stub_grader(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Replace the LLM calls with deterministic ones; record what was asked."""
    calls: list[dict] = []

    async def _outline_stub(**kwargs):
        calls.append({"kind": "outline"})
        return _outline()

    async def _question_stub(*, outline, module, language="en"):
        calls.append({"kind": "question", "module": module})
        return NextQuestion(
            question=f"{module}: why is the gap worth closing?",
            focus=f"{module} focus",
            rationale="It is the module's core.",
        )

    async def _grade_stub(**kwargs):
        calls.append(
            {
                "kind": "grade",
                "module": kwargs["module"],
                "state": kwargs["state"],
                "focus": kwargs["focus"],
            }
        )
        return RoundFeedback(
            correct=["You named the gap."],
            gaps=["You did not say why the gap persists."],
            reasoning=["Without that, the necessity does not follow."],
            hints=["Look at the paragraph after the related-work section."],
            understanding="partial",
            evidence=[
                PaperEvidence(
                    section="1 Introduction", quote="No method uses predicted contact graphs."
                )
            ],
            next_question=NextQuestion(
                question=f"{kwargs['module']}: what breaks if the contact graph is wrong?",
                focus="failure mode",
                rationale="The answer depends on an assumption you have not made explicit.",
            ),
        )

    async def _hint_stub(**kwargs):
        calls.append({"kind": "hint", "module": kwargs["module"]})
        return (
            "Re-read the paragraph after the related-work section.",
            [{"section": "2 Related Work", "quote": "...", "basis": "stated"}],
        )

    async def _summary_stub(**kwargs):
        calls.append({"kind": "summary", "module": kwargs["module"]})
        return ModuleSummary(
            mastered=["the gap"],
            gaps=["why the gap persists"],
            misconceptions=[],
            reread=["1 Introduction"],
            narrative="You have the shape of the argument; the causal step is missing.",
        )

    monkeypatch.setattr(grader, "build_outline", _outline_stub)
    monkeypatch.setattr(grader, "ask_first_question", _question_stub)
    monkeypatch.setattr(grader, "grade_answer", _grade_stub)
    monkeypatch.setattr(grader, "build_hint", _hint_stub)
    monkeypatch.setattr(grader, "build_summary", _summary_stub)
    return calls


@pytest.mark.asyncio
async def test_answering_one_module_leaves_the_other_alone(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    _paper(store)

    await submit_answer(
        store=store, paper_id="p1", module="framing", answer="Because the gap is real."
    )

    framing = store.get_module("p1", "framing")
    implementation = store.get_module("p1", "implementation")
    assert framing is not None and implementation is not None

    assert framing.rounds and framing.rounds[-1].answer == "Because the gap is real."
    assert framing.rounds[-1].feedback is not None
    assert framing.rounds[-1].feedback.gaps
    assert framing.pending_question.startswith("framing:")
    # The question the student was answering has not moved.
    assert framing.current_question == "What is the framing question?"

    # The other module did not move.
    assert implementation.current_question == "What is the implementation question?"
    assert not implementation.rounds


@pytest.mark.asyncio
async def test_a_revised_answer_keeps_the_earlier_version(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    _paper(store)

    await submit_answer(store=store, paper_id="p1", module="framing", answer="First attempt.")
    await submit_answer(store=store, paper_id="p1", module="framing", answer="Second attempt.")

    framing = store.get_module("p1", "framing")
    assert framing is not None
    # The first answer became a revision of the same round, not a new round.
    assert len(framing.rounds) == 1
    assert framing.rounds[0].answer == "Second attempt."
    assert framing.rounds[0].revisions == ["First attempt."]


@pytest.mark.asyncio
async def test_advancing_opens_the_pending_question(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    _paper(store)

    await submit_answer(store=store, paper_id="p1", module="framing", answer="An answer.")
    state = await advance_module(store=store, paper_id="p1", module="framing")

    assert state.current_question.startswith("framing:")
    assert state.pending_question == ""

    # Answering the newly opened question starts a fresh round.
    await submit_answer(store=store, paper_id="p1", module="framing", answer="Next.")
    framing = store.get_module("p1", "framing")
    assert framing is not None
    assert len(framing.rounds) == 2
    assert framing.rounds[1].answer == "Next."


@pytest.mark.asyncio
async def test_advancing_without_an_answer_is_refused(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    _paper(store)
    with pytest.raises(PaperTrainerError):
        await advance_module(store=store, paper_id="p1", module="framing")


@pytest.mark.asyncio
async def test_an_empty_answer_is_refused(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    _paper(store)
    with pytest.raises(PaperTrainerError):
        await submit_answer(store=store, paper_id="p1", module="framing", answer="   ")


@pytest.mark.asyncio
async def test_answering_an_unknown_paper_is_refused(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    with pytest.raises(PaperTrainerError):
        await submit_answer(store=store, paper_id="missing", module="framing", answer="x")


@pytest.mark.asyncio
async def test_a_hint_is_stored_on_its_own_module(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    _paper(store)

    await request_hint(store=store, paper_id="p1", module="implementation")

    implementation = store.get_module("p1", "implementation")
    framing = store.get_module("p1", "framing")
    assert implementation is not None and framing is not None
    assert implementation.hint
    assert not framing.hint


@pytest.mark.asyncio
async def test_the_summary_records_mastery_and_gaps(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_grader(monkeypatch)
    _paper(store)
    await submit_answer(
        store=store, paper_id="p1", module="framing", answer="Because the gap is real."
    )

    state = await refresh_summary(store=store, paper_id="p1", module="framing")
    assert state.summary is not None
    assert state.summary.mastered
    assert state.summary.gaps


@pytest.mark.asyncio
async def test_uploading_a_paper_opens_both_modules(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _stub_grader(monkeypatch)

    async def _fake_parse(data: bytes, filename: str) -> str:
        return "paper text"

    monkeypatch.setattr("deeptutor.paper_trainer.service._parse_paper", _fake_parse)

    state = await create_paper(store=store, filename="plan.pdf", data=b"pdf-bytes", language="en")

    assert set(state.modules) == set(MODULES)
    for module in MODULES:
        assert state.modules[module].current_question
    # Each module got its own question.
    assert {call["module"] for call in calls if call["kind"] == "question"} == set(MODULES)


# ----- structured output --------------------------------------------------


def test_malformed_evidence_is_dropped_not_fatal() -> None:
    from deeptutor.paper_trainer.store import evidence_from_dicts

    rows = [{"section": "s", "quote": "q"}, {"nope": 1}, "not a dict"]
    parsed = evidence_from_dicts(rows)
    assert len(parsed) == 1
    assert parsed[0].section == "s"


def test_feedback_survives_a_missing_section() -> None:
    from deeptutor.paper_trainer.store import feedback_from_dict

    feedback = feedback_from_dict(
        {
            "correct": ["ok"],
            "gaps": ["missing bit"],
            "understanding": "partial",
        }
    )
    assert feedback.correct == ["ok"]
    assert feedback.gaps == ["missing bit"]
    assert feedback.evidence == []
    assert feedback.next_question is None


def test_an_outline_survives_list_valued_scalar_fields() -> None:
    """A model answering a string field with a list must not cost the outline."""
    from deeptutor.paper_trainer.grader import _coerce_outline

    outline = _coerce_outline(
        {
            "title": "Attention Is All You Need",
            "experiments": ["WMT 2014 En-De", "4.5M sentence pairs"],
            "results": ["28.4 BLEU"],
            "methods": "self-attention; feed-forward layers",
            "sections": ["1 Introduction", "1 Introduction", "3.2 Complexity"],
        }
    )
    assert outline.title == "Attention Is All You Need"
    assert outline.experiments == "WMT 2014 En-De; 4.5M sentence pairs"
    assert outline.results == "28.4 BLEU"
    assert outline.methods == ["self-attention", "feed-forward layers"]
    assert outline.sections == ["1 Introduction", "3.2 Complexity"]


def test_repeated_failure_on_one_point_is_counted() -> None:
    from deeptutor.paper_trainer.grader import _repeat_streak

    def round_(focus: str, understanding: str, answer: str = "an answer") -> dict:
        return {
            "focus": focus,
            "answer": answer,
            "feedback": {"understanding": understanding},
        }

    history = [
        round_("path length", "partial"),
        round_("path length", "incorrect"),
    ]
    assert _repeat_streak(history, "path length") == 2
    assert _repeat_streak(history, "path  LENGTH") == 2
    assert _repeat_streak(history, "prior work") == 0

    # A correct answer ends the streak, as does a question on another point.
    assert _repeat_streak(history + [round_("path length", "correct")], "path length") == 0
    assert _repeat_streak(history + [round_("prior work", "partial")], "path length") == 0
    # An unanswered round never counts as a failed attempt.
    assert (
        _repeat_streak(history + [round_("path length", "partial", answer="")], "path length") == 0
    )


def test_a_rewritten_focus_still_counts_as_the_same_point() -> None:
    """The model rewords the focus every round; the streak must still grow."""
    from deeptutor.paper_trainer.grader import _repeat_streak, _same_point

    first = "1 Introduction — 路径长度（path length）随距离增长与学习长距离依赖难度之间的关系"
    second = "路径长度（path length）与长距离依赖的学习难度"
    third = "把「路径长度」落成可数的运算步数：循环结构里它随距离线性增长，自注意力里它是常数"

    assert _same_point(first, second)
    assert _same_point(second, third)

    # A genuinely different knowledge point must not be treated as the same one.
    serial = "循环模型的串行计算依赖，及其对样本内并行化的封锁（研究空白的成因）"
    assert not _same_point(serial, third)
    assert not _same_point(serial, first)

    history = [
        {"focus": first, "answer": "a", "feedback": {"understanding": "partial"}},
        {"focus": second, "answer": "b", "feedback": {"understanding": "incorrect"}},
    ]
    assert _repeat_streak(history, third) == 2


def test_the_graders_prompt_carries_the_module_state() -> None:
    from deeptutor.paper_trainer.grader import _state_brief

    summary = {
        "mastered": ["the gap"],
        "gaps": ["why the gap persists"],
        "misconceptions": [],
    }
    brief = _state_brief(summary)
    assert "the gap" in brief
    assert "why the gap persists" in brief
    # A wrapper carrying the summary reads identically.
    assert _state_brief({"summary": summary}) == brief
    assert _state_brief({}) == ""


@pytest.mark.asyncio
async def test_a_later_answer_is_graded_against_what_the_student_mastered(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _stub_grader(monkeypatch)
    _paper(store)

    await submit_answer(store=store, paper_id="p1", module="framing", answer="First.")
    await refresh_summary(store=store, paper_id="p1", module="framing")
    await submit_answer(store=store, paper_id="p1", module="framing", answer="Second.")

    graded = [call for call in calls if call["kind"] == "grade"]
    assert graded[-1]["state"]["mastered"] == ["the gap"]


@pytest.mark.asyncio
async def test_the_graders_prompt_knows_the_point_being_asked(
    store: PaperTrainerStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _stub_grader(monkeypatch)
    _paper(store)
    await submit_answer(store=store, paper_id="p1", module="framing", answer="An answer.")

    graded = [call for call in calls if call["kind"] == "grade"]
    assert graded[-1]["focus"] == "framing focus"
