"""Durable state for the paper-reading trainer.

One SQLite file holds every paper the user has trained on. The tables are
keyed by ``(paper_id, module)`` so the two training modules of the same paper
never share a row, and so a module's history survives a reload.

The store is synchronous ``sqlite3`` — the same shape as the other feature
stores in this repo — and the router calls it through ``asyncio.to_thread``.
"""

from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import threading
import time
from typing import Any, Iterator

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

_SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS papers (
    paper_id     TEXT PRIMARY KEY,
    filename     TEXT NOT NULL DEFAULT '',
    title        TEXT NOT NULL DEFAULT '',
    source_url   TEXT NOT NULL DEFAULT '',
    outline_json TEXT NOT NULL DEFAULT '{}',
    created_at   REAL NOT NULL,
    updated_at   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS module_state (
    paper_id     TEXT NOT NULL,
    module       TEXT NOT NULL,
    state_json   TEXT NOT NULL DEFAULT '{}',
    updated_at   REAL NOT NULL,
    PRIMARY KEY (paper_id, module)
);

CREATE INDEX IF NOT EXISTS idx_module_state_paper
    ON module_state (paper_id);
"""

#: The two modules, in the order they appear in the UI.
MODULES: tuple[ModuleId, ...] = ("framing", "implementation")

_schema_lock = threading.RLock()
_initialized_paths: set[Path] = set()


def default_db_path() -> Path:
    """Where the trainer's database lives."""
    from deeptutor.services.path_service import get_path_service

    return get_path_service().user_data_dir / "paper_trainer" / "trainer.sqlite3"


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _load(raw: str) -> Any:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {}


class PaperTrainerStore:
    """Per-user store for papers and their two training modules."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else default_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_initialized()

    def _ensure_initialized(self) -> None:
        resolved = self.db_path.resolve()
        if resolved in _initialized_paths:
            return
        with _schema_lock:
            if resolved in _initialized_paths:
                return
            with self._connect() as conn:
                conn.executescript(_SCHEMA)
            _initialized_paths.add(resolved)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 30000")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    # ----- papers ---------------------------------------------------------

    def upsert_paper(
        self,
        *,
        paper_id: str,
        filename: str,
        title: str,
        source_url: str,
        outline: PaperOutline,
    ) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO papers (
                    paper_id, filename, title, source_url, outline_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(paper_id) DO UPDATE SET
                    filename = excluded.filename,
                    title = excluded.title,
                    source_url = excluded.source_url,
                    outline_json = excluded.outline_json,
                    updated_at = excluded.updated_at
                """,
                (
                    paper_id,
                    filename,
                    title,
                    source_url,
                    _dump(outline.model_dump()),
                    now,
                    now,
                ),
            )

    def get_paper(self, paper_id: str) -> PaperState | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM papers WHERE paper_id = ?", (paper_id,)).fetchone()
            if row is None:
                return None
            outline = PaperOutline.model_validate(_load(row["outline_json"]) or {})
            modules = self._load_modules(conn, paper_id)
            return PaperState(
                paper_id=row["paper_id"],
                filename=row["filename"],
                title=row["title"],
                source_url=row["source_url"],
                outline=outline,
                modules=modules,
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )

    def delete_paper(self, paper_id: str) -> bool:
        with self._connect() as conn:
            conn.execute("DELETE FROM module_state WHERE paper_id = ?", (paper_id,))
            cursor = conn.execute("DELETE FROM papers WHERE paper_id = ?", (paper_id,))
            return cursor.rowcount > 0

    # ----- modules --------------------------------------------------------

    def _load_modules(self, conn: sqlite3.Connection, paper_id: str) -> dict[str, ModuleState]:
        rows = conn.execute(
            "SELECT module, state_json FROM module_state WHERE paper_id = ?",
            (paper_id,),
        ).fetchall()
        modules: dict[str, ModuleState] = {}
        for row in rows:
            payload = _load(row["state_json"])
            if not isinstance(payload, dict):
                continue
            modules[row["module"]] = ModuleState.model_validate(payload)
        return modules

    def save_module(self, paper_id: str, state: ModuleState) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO module_state (paper_id, module, state_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(paper_id, module) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at
                """,
                (paper_id, state.module, _dump(state.model_dump()), now),
            )
            conn.execute("UPDATE papers SET updated_at = ? WHERE paper_id = ?", (now, paper_id))

    def get_module(self, paper_id: str, module: ModuleId) -> ModuleState | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT state_json FROM module_state WHERE paper_id = ? AND module = ?",
                (paper_id, module),
            ).fetchone()
        if row is None:
            return None
        payload = _load(row["state_json"])
        if not isinstance(payload, dict):
            return None
        return ModuleState.model_validate(payload)


# ----- state <-> rows ---------------------------------------------------


def evidence_from_dicts(rows: list[dict[str, Any]]) -> list[PaperEvidence]:
    """Rebuild evidence rows, dropping anything malformed.

    The grader's output is model-produced, so a single bad row must not cost
    the student their whole round.
    """
    out: list[PaperEvidence] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        try:
            out.append(PaperEvidence.model_validate(row))
        except Exception:
            continue
    return out


def feedback_from_dict(payload: dict[str, Any]) -> RoundFeedback:
    """Rebuild a feedback object, tolerating missing or malformed parts."""
    if not isinstance(payload, dict):
        return RoundFeedback()
    data = dict(payload)
    data["evidence"] = [e.model_dump() for e in evidence_from_dicts(data.get("evidence"))]
    next_question = data.get("next_question")
    if isinstance(next_question, dict):
        next_question = dict(next_question)
        next_question["evidence"] = [
            e.model_dump() for e in evidence_from_dicts(next_question.get("evidence"))
        ]
        data["next_question"] = next_question
    try:
        return RoundFeedback.model_validate(data)
    except Exception:
        return RoundFeedback(
            correct=[str(x) for x in (data.get("correct") or [])],
            gaps=[str(x) for x in (data.get("gaps") or [])],
            reasoning=[str(x) for x in (data.get("reasoning") or [])],
            hints=[str(x) for x in (data.get("hints") or [])],
            evidence=data.get("evidence") or [],
        )


def next_question_from_dict(payload: dict[str, Any] | None) -> NextQuestion | None:
    if not isinstance(payload, dict):
        return None
    data = dict(payload)
    data["evidence"] = [e.model_dump() for e in evidence_from_dicts(data.get("evidence"))]
    try:
        return NextQuestion.model_validate(data)
    except Exception:
        return None


def summary_from_dict(payload: dict[str, Any] | None) -> ModuleSummary | None:
    if not isinstance(payload, dict):
        return None
    try:
        return ModuleSummary.model_validate(payload)
    except Exception:
        return None


def round_from_dict(payload: dict[str, Any]) -> RoundState:
    data = dict(payload)
    data["evidence"] = [e.model_dump() for e in evidence_from_dicts(data.get("evidence"))]
    feedback = data.get("feedback")
    if isinstance(feedback, dict):
        data["feedback"] = feedback_from_dict(feedback).model_dump()
    try:
        return RoundState.model_validate(data)
    except Exception:
        return RoundState()


__all__ = [
    "MODULES",
    "PaperTrainerStore",
    "default_db_path",
    "evidence_from_dicts",
    "feedback_from_dict",
    "next_question_from_dict",
    "round_from_dict",
    "summary_from_dict",
]
