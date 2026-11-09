"""Paper-reading trainer: two independent modules over one uploaded paper.

The student uploads a paper; the trainer then interviews them about it in two
separate modules — one about *why* the research was needed, one about *how* it
was implemented. Each module keeps its own questions, answers, feedback and
history; only the paper is shared.
"""

from deeptutor.paper_trainer.models import (
    ModuleId,
    ModuleState,
    ModuleSummary,
    NextQuestion,
    PaperEvidence,
    PaperOutline,
    PaperState,
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

__all__ = [
    "MODULES",
    "ModuleId",
    "ModuleState",
    "ModuleSummary",
    "NextQuestion",
    "PaperEvidence",
    "PaperOutline",
    "PaperState",
    "PaperTrainerError",
    "PaperTrainerStore",
    "RoundFeedback",
    "RoundState",
    "advance_module",
    "create_paper",
    "refresh_summary",
    "request_hint",
    "submit_answer",
]
