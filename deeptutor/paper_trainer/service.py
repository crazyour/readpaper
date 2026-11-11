"""Orchestration for the paper-reading trainer.

The service owns the flow the API exposes:

* upload a paper → parse it → open **both** modules with their own first
  question;
* answer in one module → grade it → get the module's next question, without
  touching the other module;
* ask for a hint → get a pointer into the paper;
* ask for a summary → get the module's learning state.

The two modules never share anything but the paper. Each has its own rounds,
its own summary, its own current question, and its own row in the store.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path
import time
from typing import Any

from deeptutor.paper_trainer import grader
from deeptutor.paper_trainer.models import (
    ModuleId,
    ModuleState,
    ModuleSummary,
    NextQuestion,
    PaperState,
    RoundFeedback,
    RoundState,
)
from deeptutor.paper_trainer.store import MODULES, PaperTrainerStore, evidence_from_dicts

logger = logging.getLogger(__name__)

#: The answer length a round accepts. Long enough for a considered answer,
#: short enough that a pasted essay does not blow the context window.
MAX_ANSWER_CHARS = 12000
MAX_FILENAME_CHARS = 200


class PaperTrainerError(RuntimeError):
    """A refusal the API reports to the student verbatim."""


def _beginner_question(module: ModuleId, language: str) -> NextQuestion:
    chinese = str(language).lower().startswith("zh")
    if module == "framing":
        return NextQuestion(
            question=(
                "请用自己的话说说：这篇论文主要想解决什么问题？"
                if chinese
                else "In your own words, what main problem is this paper trying to solve?"
            ),
            focus="核心问题" if chinese else "Core problem",
        )
    return NextQuestion(
        question=(
            "作者用了什么主要方法来解决这个问题？"
            if chinese
            else "What main method did the authors use to address that problem?"
        ),
        focus="主要方法" if chinese else "Main method",
    )


def _paper_id(filename: str, data: bytes) -> str:
    """A stable id for a paper: the same file uploaded twice is one paper."""
    digest = hashlib.sha256(data).hexdigest()[:16]
    stem = "".join(ch if ch.isalnum() else "_" for ch in Path(filename).stem)[:40]
    return f"{stem or 'paper'}_{digest}"


async def _parse_paper(data: bytes, filename: str) -> str:
    """Extract the paper's text.

    Prefers the configured document parser (the same engine the chat
    composer uses, so a PDF the learner can read there is readable here),
    and falls back to the native extractor — which lives in core and needs no
    extra module — so a plain install still works.
    """
    text = ""
    try:
        from deeptutor.services.parsing import get_parse_service

        parsed = await asyncio.to_thread(
            get_parse_service().parse, _temp_paper_path(data, filename)
        )
        text = str(parsed.markdown or "").strip()
    except Exception:
        # No configured parser, or it failed. The native extractor below is
        # the fallback; a real failure there is reported to the student.
        logger.info("configured parser unavailable for %s", filename, exc_info=True)
        text = ""

    if not text:
        try:
            from deeptutor.utils.document_extractor import extract_text_from_bytes

            text = extract_text_from_bytes(filename, data)
        except Exception:
            logger.info("native extraction failed for %s", filename, exc_info=True)
            text = ""

    if not text.strip():
        raise PaperTrainerError(
            "The paper could not be read. It may be a scanned PDF without a "
            "text layer — try a PDF with selectable text, or a Word document."
        )
    return text


def _temp_paper_path(data: bytes, filename: str) -> Path:
    """A temporary on-disk copy for parsers that read from a path."""
    import tempfile

    suffix = Path(filename).suffix or ".pdf"
    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        handle.write(data)
    finally:
        handle.close()
    return Path(handle.name)


def _evidence(items: list[Any]) -> list:
    """Normalise evidence that may arrive as models or as plain dicts."""
    return evidence_from_dicts(
        [item.model_dump() if hasattr(item, "model_dump") else item for item in items or []]
    )


def _rounds_payload(state: ModuleState) -> list[dict[str, Any]]:
    """The module's rounds as plain dicts, for the grading prompt."""
    return [
        {
            "question": item.question,
            "answer": item.answer,
            "focus": item.focus,
            "feedback": item.feedback.model_dump() if item.feedback else {},
        }
        for item in state.rounds
    ]


def _summary_payload(state: ModuleState) -> dict[str, Any]:
    return state.summary.model_dump() if state.summary else {}


def _apply_feedback_to_state(state: ModuleState, feedback: RoundFeedback, *, focus: str) -> None:
    """Fold one round's feedback into the module's standing knowledge state.

    The summary is the module's memory: what the student has mastered, what
    they still get wrong, and which misreadings are worth correcting. It is
    rebuilt from the rounds each time so it can never drift from the history.
    """
    mastered: list[str] = []
    gaps: list[str] = []
    misconceptions: list[str] = []
    for item in state.rounds:
        if item.feedback is None:
            continue
        if item.feedback.understanding in {"correct", "mastered"}:
            label = item.focus or item.question
            if label and label not in mastered:
                mastered.append(label)
        for gap in item.feedback.gaps:
            if gap and gap not in gaps:
                gaps.append(gap)
        if item.feedback.understanding == "incorrect":
            label = item.focus or item.question
            if label and label not in misconceptions:
                misconceptions.append(label)

    reread: list[str] = []
    for item in state.rounds:
        for evidence in item.feedback.evidence if item.feedback else []:
            if evidence.section and evidence.section not in reread:
                reread.append(evidence.section)

    narrative = ""
    if state.summary is not None:
        narrative = state.summary.narrative
    state.summary = ModuleSummary(
        mastered=mastered[:20],
        gaps=gaps[:20],
        misconceptions=misconceptions[:20],
        reread=reread[:20],
        narrative=narrative,
    )


async def create_paper(
    *,
    store: PaperTrainerStore,
    filename: str,
    data: bytes,
    language: str = "en",
    difficulty: str = "research",
) -> PaperState:
    """Parse a paper and open both training modules on it.

    Both modules get their own first question, generated independently: a
    student may work on either one first, and neither waits for the other.
    """
    started = time.perf_counter()
    name = Path(filename or "paper.pdf").name[:MAX_FILENAME_CHARS]
    paper_text = await _parse_paper(data, name)
    paper_id = _paper_id(name, data)

    if difficulty == "beginner":
        outline = await grader.build_outline(paper_text=paper_text, language=language)
        opening_questions = {
            module: _beginner_question(module, language) for module in MODULES
        }
    else:
        outline, opening_questions = await grader.prepare_paper(
            paper_text=paper_text,
            language=language,
            difficulty=difficulty,
        )
        missing = [
            module for module in MODULES if not opening_questions[module].question
        ]
        if missing:
            generated = await asyncio.gather(
                *(
                    grader.ask_first_question(
                        outline=outline,
                        module=module,
                        language=language,
                        difficulty=difficulty,
                    )
                    for module in missing
                )
            )
            opening_questions.update(dict(zip(missing, generated)))
    title = outline.title or Path(name).stem

    source_url = ""
    try:
        from deeptutor.services.storage import get_attachment_store

        source_url = await get_attachment_store().put(
            session_id=f"paper-trainer-{paper_id}",
            attachment_id="source",
            filename=name,
            data=data,
            mime_type="application/pdf",
        )
    except Exception:
        # The original file is a convenience (the "view original" panel);
        # a failure to store it must not cost the student their session.
        logger.info("could not store the original file for %s", paper_id, exc_info=True)

    store.upsert_paper(
        paper_id=paper_id,
        filename=name,
        title=title,
        source_url=source_url,
        outline=outline,
        paper_text=paper_text,
    )

    modules: dict[str, ModuleState] = {}
    for module in MODULES:
        question = opening_questions[module]
        state = ModuleState(
            module=module,
            current_question=question.question,
            current_focus=question.focus,
        )
        modules[module] = state
        await asyncio.to_thread(store.save_module, paper_id, state)

    logger.info(
        "paper trainer prepared paper_id=%s chars=%d elapsed_ms=%d",
        paper_id,
        len(paper_text),
        round((time.perf_counter() - started) * 1000),
    )

    return PaperState(
        paper_id=paper_id,
        filename=name,
        title=title,
        source_url=source_url,
        outline=outline,
        modules={module: state.model_dump() for module, state in modules.items()},
    )


async def submit_answer(
    *,
    store: PaperTrainerStore,
    paper_id: str,
    module: ModuleId,
    answer: str,
    language: str = "en",
    difficulty: str = "research",
    paper_text: str = "",
) -> ModuleState:
    """Grade one answer for the module's current question.

    The question does not move on by itself. Grading stores the next question
    as *pending*; the student may revise this answer as often as they like and
    only advances through :func:`advance_module`. Re-answering the same
    question replaces the answer in place and keeps every earlier version in
    ``revisions``, so a change of mind never erases what was written first.
    """
    text = (answer or "").strip()
    if not text:
        raise PaperTrainerError("Write an answer before submitting.")
    if len(text) > MAX_ANSWER_CHARS:
        text = text[:MAX_ANSWER_CHARS]

    paper = await asyncio.to_thread(store.get_paper, paper_id)
    if paper is None:
        raise PaperTrainerError("This paper is no longer available.")
    state = await asyncio.to_thread(store.get_module, paper_id, module)
    if state is None:
        raise PaperTrainerError("This training module is not open yet.")
    if not state.current_question:
        raise PaperTrainerError("This module has no question waiting for an answer.")

    if not paper_text:
        paper_text = await asyncio.to_thread(store.get_paper_text, paper_id)

    question = state.current_question
    current = state.rounds[-1] if state.rounds else None
    revising = current is not None and current.question == question

    # A revision is graded on its own merits: the earlier verdict on this
    # question would only bias the model towards agreeing with itself.
    history = _rounds_payload(state)
    if revising:
        history = history[:-1]

    feedback = await grader.grade_answer(
        outline=paper.outline,
        module=module,
        question=question,
        answer=text,
        history=history,
        state=_summary_payload(state),
        focus=state.current_focus,
        language=language,
        difficulty=difficulty,
        paper_excerpt=paper_text,
    )

    if revising and current is not None:
        if current.answer.strip() and current.answer.strip() != text:
            current.revisions.append(current.answer)
        current.answer = text
        round_state = current
    else:
        round_state = RoundState(
            index=len(state.rounds),
            question=question,
            focus=state.current_focus,
            answer=text,
            created_at=_now(),
        )
        state.rounds.append(round_state)

    round_state.feedback = feedback
    round_state.evidence = list(feedback.evidence)
    round_state.updated_at = _now()

    _apply_feedback_to_state(state, feedback, focus=state.current_focus)

    next_question = feedback.next_question
    if next_question is not None and next_question.question:
        state.pending_question = next_question.question
        state.pending_focus = next_question.focus
        state.finished = False
    else:
        state.pending_question = ""
        state.pending_focus = ""
        state.finished = True

    state.hint = ""
    state.hint_evidence = []

    await asyncio.to_thread(store.save_module, paper_id, state)
    return state


async def advance_module(
    *,
    store: PaperTrainerStore,
    paper_id: str,
    module: ModuleId,
) -> ModuleState:
    """Move the module on to the question the last answer earned.

    The student drives this: after reading the feedback they either revise the
    answer they just gave or ask to continue. Nothing advances on its own, so
    the two modules stay independent and no answer is skipped.
    """
    paper = await asyncio.to_thread(store.get_paper, paper_id)
    if paper is None:
        raise PaperTrainerError("This paper is no longer available.")
    state = await asyncio.to_thread(store.get_module, paper_id, module)
    if state is None:
        raise PaperTrainerError("This training module is not open yet.")
    if not state.pending_question:
        raise PaperTrainerError("There is no next question waiting. Answer the current one first.")

    state.current_question = state.pending_question
    state.current_focus = state.pending_focus
    state.pending_question = ""
    state.pending_focus = ""
    state.hint = ""
    state.hint_evidence = []
    state.finished = False

    await asyncio.to_thread(store.save_module, paper_id, state)
    return state


async def request_hint(
    *,
    store: PaperTrainerStore,
    paper_id: str,
    module: ModuleId,
    language: str = "en",
    difficulty: str = "research",
    paper_text: str = "",
) -> ModuleState:
    """Give the student a pointer into the paper instead of the answer."""
    paper = await asyncio.to_thread(store.get_paper, paper_id)
    if paper is None:
        raise PaperTrainerError("This paper is no longer available.")
    state = await asyncio.to_thread(store.get_module, paper_id, module)
    if state is None:
        raise PaperTrainerError("This training module is not open yet.")
    if not state.current_question:
        raise PaperTrainerError("There is no question waiting for a hint.")

    if not paper_text:
        paper_text = await asyncio.to_thread(store.get_paper_text, paper_id)

    hint, evidence = await grader.build_hint(
        outline=paper.outline,
        module=module,
        question=state.current_question,
        language=language,
        difficulty=difficulty,
        paper_excerpt=paper_text,
    )
    state.hint = hint
    state.hint_evidence = _evidence(evidence)
    await asyncio.to_thread(store.save_module, paper_id, state)
    return state


async def refresh_summary(
    *,
    store: PaperTrainerStore,
    paper_id: str,
    module: ModuleId,
    language: str = "en",
    difficulty: str = "research",
) -> ModuleState:
    """Rebuild the module's learning summary from its exchanges."""
    paper = await asyncio.to_thread(store.get_paper, paper_id)
    if paper is None:
        raise PaperTrainerError("This paper is no longer available.")
    state = await asyncio.to_thread(store.get_module, paper_id, module)
    if state is None:
        raise PaperTrainerError("This training module is not open yet.")

    summary = await grader.build_summary(
        outline=paper.outline,
        module=module,
        history=_rounds_payload(state),
        state=_summary_payload(state),
        language=language,
        difficulty=difficulty,
    )
    state.summary = summary
    await asyncio.to_thread(store.save_module, paper_id, state)
    return state


def _now() -> float:
    import time

    return time.time()


__all__ = [
    "MAX_ANSWER_CHARS",
    "PaperTrainerError",
    "advance_module",
    "create_paper",
    "refresh_summary",
    "request_hint",
    "submit_answer",
]
