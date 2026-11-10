"""Paper-reading trainer API.

Every endpoint works on one paper and, where a module is involved, on one
module of that paper. The two modules are independent: answering in one
never touches the other's question, history or progress.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from deeptutor.paper_trainer.models import ModuleId, ModuleState, PaperState
from deeptutor.paper_trainer.service import (
    MAX_ANSWER_CHARS,
    PaperTrainerError,
    advance_module,
    create_paper,
    refresh_summary,
    request_hint,
    submit_answer,
)
from deeptutor.paper_trainer.store import PaperTrainerStore
from deeptutor.services.llm.exceptions import LLMError

router = APIRouter()

logger = logging.getLogger(__name__)

#: The upload ceiling. Generous enough for a thesis-sized PDF, small enough
#: that one request cannot exhaust the server.
MAX_UPLOAD_BYTES = 40 * 1024 * 1024

ALLOWED_SUFFIXES = (".pdf", ".docx", ".txt", ".md")


class AnswerRequest(BaseModel):
    answer: str = Field(default="", max_length=MAX_ANSWER_CHARS + 2000)


class ModuleResponse(BaseModel):
    """One module's state, exactly as the UI renders it."""

    module: ModuleId
    current_question: str = ""
    current_focus: str = ""
    pending_question: str = ""
    pending_focus: str = ""
    hint: str = ""
    hint_evidence: list[dict[str, Any]] = Field(default_factory=list)
    rounds: list[dict[str, Any]] = Field(default_factory=list)
    summary: dict[str, Any] | None = None
    finished: bool = False


class PaperResponse(BaseModel):
    """A paper and both of its modules."""

    paper_id: str
    filename: str = ""
    title: str = ""
    source_url: str = ""
    outline: dict[str, Any] = Field(default_factory=dict)
    modules: dict[str, ModuleResponse] = Field(default_factory=dict)
    created_at: float = 0.0
    updated_at: float = 0.0


def _module_response(state: ModuleState) -> ModuleResponse:
    return ModuleResponse(
        module=state.module,
        current_question=state.current_question,
        current_focus=state.current_focus,
        pending_question=state.pending_question,
        pending_focus=state.pending_focus,
        hint=state.hint,
        hint_evidence=[item.model_dump() for item in state.hint_evidence],
        rounds=[item.model_dump() for item in state.rounds],
        summary=state.summary.model_dump() if state.summary else None,
        finished=state.finished,
    )


def _paper_response(state: PaperState) -> PaperResponse:
    return PaperResponse(
        paper_id=state.paper_id,
        filename=state.filename,
        title=state.title,
        source_url=state.source_url,
        outline=state.outline.model_dump(),
        modules={name: _module_response(module) for name, module in state.modules.items()},
        created_at=state.created_at,
        updated_at=state.updated_at,
    )


def _store() -> PaperTrainerStore:
    return PaperTrainerStore()


def _module_or_400(module: str) -> ModuleId:
    if module not in {"framing", "implementation"}:
        raise HTTPException(status_code=404, detail="Unknown training module.")
    return module  # type: ignore[return-value]


def _language(language: str | None) -> str:
    return "zh" if str(language or "").lower().startswith("zh") else "en"


def _difficulty(difficulty: str | None) -> str:
    return difficulty if difficulty in {"beginner", "research", "domain"} else "research"


def _failure(exc: Exception, *, what: str, detail: str) -> HTTPException:
    """Turn a service failure into the answer the student should see.

    A missing or exhausted model is the one failure the student can act on, so
    it gets its own status and message; everything else is reported as a
    transient server problem and logged with its traceback.
    """
    if isinstance(exc, (LLMError, TimeoutError)):
        logger.warning("%s failed via the language model: %s", what, exc)
        return HTTPException(
            status_code=503,
            detail=(
                "The language model is not available right now. Check the model "
                "in Settings, then try again."
            ),
        )
    logger.exception("%s failed", what)
    return HTTPException(status_code=502, detail=detail)


@router.post("/papers")
async def upload_paper(
    file: UploadFile = File(...),
    language: str = Form(""),
    difficulty: str = Form("research"),
) -> PaperResponse:
    """Upload a paper, parse it, and open both training modules on it."""
    filename = file.filename or "paper.pdf"
    if not filename.lower().endswith(ALLOWED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail="Only PDF, Word, Markdown and plain-text papers are supported.",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="The paper is too large. Please upload a smaller file.",
        )
    try:
        state = await create_paper(
            store=_store(),
            filename=filename,
            data=data,
            language=_language(language),
            difficulty=_difficulty(difficulty),
        )
    except PaperTrainerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _failure(
            exc,
            what="Preparing the paper",
            detail="The paper could not be prepared. Please try again.",
        ) from exc
    return _paper_response(state)


@router.get("/papers/{paper_id}")
async def get_paper(paper_id: str) -> PaperResponse:
    """Restore a paper and both of its modules — used on page reload."""
    state = await asyncio.to_thread(_store().get_paper, paper_id)
    if state is None:
        raise HTTPException(status_code=404, detail="This paper is no longer available.")
    return _paper_response(state)


@router.post("/papers/{paper_id}/modules/{module}/answer")
async def answer_question(
    paper_id: str,
    module: str,
    payload: AnswerRequest,
    language: str = "",
    difficulty: str = "research",
) -> ModuleResponse:
    """Grade one answer and return the module's next question."""
    module_id = _module_or_400(module)
    try:
        state = await submit_answer(
            store=_store(),
            paper_id=paper_id,
            module=module_id,
            answer=payload.answer,
            language=_language(language),
            difficulty=_difficulty(difficulty),
        )
    except PaperTrainerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _failure(
            exc,
            what=f"Grading an answer in {module_id}",
            detail="The answer could not be graded. Please try again.",
        ) from exc
    return _module_response(state)


@router.post("/papers/{paper_id}/modules/{module}/advance")
async def advance_question(
    paper_id: str,
    module: str,
) -> ModuleResponse:
    """Move the module on to the question its last answer earned."""
    module_id = _module_or_400(module)
    try:
        state = await advance_module(store=_store(), paper_id=paper_id, module=module_id)
    except PaperTrainerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _failure(
            exc,
            what=f"Opening the next question in {module_id}",
            detail="The next question could not be opened. Please try again.",
        ) from exc
    return _module_response(state)


@router.post("/papers/{paper_id}/modules/{module}/hint")
async def ask_hint(
    paper_id: str,
    module: str,
    language: str = "",
    difficulty: str = "research",
) -> ModuleResponse:
    """Give a pointer into the paper instead of the answer."""
    module_id = _module_or_400(module)
    try:
        state = await request_hint(
            store=_store(),
            paper_id=paper_id,
            module=module_id,
            language=_language(language),
            difficulty=_difficulty(difficulty),
        )
    except PaperTrainerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _failure(
            exc,
            what=f"Preparing a hint in {module_id}",
            detail="A hint could not be prepared. Please try again.",
        ) from exc
    return _module_response(state)


@router.post("/papers/{paper_id}/modules/{module}/summary")
async def get_summary(
    paper_id: str,
    module: str,
    language: str = "",
    difficulty: str = "research",
) -> ModuleResponse:
    """Rebuild the module's learning summary."""
    module_id = _module_or_400(module)
    try:
        state = await refresh_summary(
            store=_store(),
            paper_id=paper_id,
            module=module_id,
            language=_language(language),
            difficulty=_difficulty(difficulty),
        )
    except PaperTrainerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _failure(
            exc,
            what=f"Building the summary of {module_id}",
            detail="The summary could not be built. Please try again.",
        ) from exc
    return _module_response(state)


__all__ = ["router"]
