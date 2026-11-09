"""HTTP-level tests for the paper-trainer router.

These pin the shape the frontend depends on: multipart upload, both modules
opened at once, one module's answer leaving the other alone, and a model
failure reported as something the student can act on.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deeptutor.api.routers import paper_trainer as router_module
from deeptutor.paper_trainer import grader
from deeptutor.paper_trainer.models import (
    ModuleSummary,
    NextQuestion,
    PaperEvidence,
    PaperOutline,
    RoundFeedback,
)
from deeptutor.paper_trainer.store import MODULES, PaperTrainerStore
from deeptutor.services.llm.exceptions import LLMError

PREFIX = "/api/paper-trainer"


def _outline() -> PaperOutline:
    return PaperOutline(
        title="Graph neural networks for protein function prediction",
        research_gap="No method uses predicted contact graphs.",
        objective="Build a GAT-based predictor.",
        methods=["Graph attention network"],
        sections=["1 Introduction", "2 Related Work"],
    )


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    store = PaperTrainerStore(tmp_path / "trainer.sqlite3")

    async def _outline_stub(**_kwargs):
        return _outline()

    async def _question_stub(*, module, **_kwargs):
        return NextQuestion(
            question=f"{module}: why is the gap worth closing?",
            focus=f"{module} focus",
        )

    async def _grade_stub(**kwargs):
        module = kwargs["module"]
        return RoundFeedback(
            correct=["You named the gap."],
            gaps=["You did not say why it persists."],
            reasoning=["Without that, necessity does not follow."],
            hints=["Look after the related-work section."],
            understanding="partial",
            evidence=[
                PaperEvidence(
                    section="1 Introduction",
                    quote="No method uses predicted contact graphs.",
                )
            ],
            next_question=NextQuestion(
                question=f"{module}: what breaks if the graph is wrong?",
                focus="failure mode",
            ),
        )

    async def _hint_stub(**_kwargs):
        return (
            "Re-read the paragraph after the related work.",
            [
                PaperEvidence(
                    section="2 Related Work",
                    quote="Sequence models ignore structure.",
                )
            ],
        )

    async def _summary_stub(**_kwargs):
        return ModuleSummary(
            mastered=["the gap"],
            gaps=["why the gap persists"],
            reread=["1 Introduction"],
            narrative="The causal step is missing.",
        )

    async def _parse_stub(data: bytes, filename: str) -> str:
        return "paper text"

    monkeypatch.setattr(grader, "build_outline", _outline_stub)
    monkeypatch.setattr(grader, "ask_first_question", _question_stub)
    monkeypatch.setattr(grader, "grade_answer", _grade_stub)
    monkeypatch.setattr(grader, "build_hint", _hint_stub)
    monkeypatch.setattr(grader, "build_summary", _summary_stub)
    monkeypatch.setattr("deeptutor.paper_trainer.service._parse_paper", _parse_stub)
    monkeypatch.setattr(router_module, "_store", lambda: store)

    app = FastAPI()
    app.include_router(router_module.router, prefix=PREFIX)
    return TestClient(app)


def _upload(client: TestClient) -> dict:
    response = client.post(
        f"{PREFIX}/papers",
        files={"file": ("plan.pdf", b"%PDF-1.4 paper", "application/pdf")},
        data={"language": "en"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_upload_opens_both_modules(client: TestClient) -> None:
    body = _upload(client)

    assert set(body["modules"]) == set(MODULES)
    questions = {body["modules"][name]["current_question"] for name in MODULES}
    assert len(questions) == len(MODULES)
    assert body["modules"]["framing"]["rounds"] == []


def test_answering_one_module_leaves_the_other_alone(client: TestClient) -> None:
    paper = _upload(client)
    paper_id = paper["paper_id"]

    response = client.post(
        f"{PREFIX}/papers/{paper_id}/modules/framing/answer",
        json={"answer": "Because the gap is real."},
    )
    assert response.status_code == 200, response.text
    framing = response.json()

    assert framing["rounds"][-1]["answer"] == "Because the gap is real."
    assert framing["rounds"][-1]["feedback"]["gaps"]
    # The question stays put until the student asks to continue.
    assert framing["current_question"] == "framing: why is the gap worth closing?"
    assert framing["pending_question"] == "framing: what breaks if the graph is wrong?"

    implementation = client.get(f"{PREFIX}/papers/{paper_id}").json()["modules"][
        "implementation"
    ]
    assert implementation["rounds"] == []
    assert implementation["current_question"] == "implementation: why is the gap worth closing?"


def test_advancing_opens_the_pending_question(client: TestClient) -> None:
    paper_id = _upload(client)["paper_id"]
    client.post(
        f"{PREFIX}/papers/{paper_id}/modules/implementation/answer",
        json={"answer": "An answer."},
    )

    response = client.post(
        f"{PREFIX}/papers/{paper_id}/modules/implementation/advance"
    )
    assert response.status_code == 200, response.text
    state = response.json()
    assert state["current_question"] == "implementation: what breaks if the graph is wrong?"
    assert state["pending_question"] == ""


def test_revising_keeps_the_earlier_answer(client: TestClient) -> None:
    paper_id = _upload(client)["paper_id"]
    for answer in ("First attempt.", "Second attempt."):
        client.post(
            f"{PREFIX}/papers/{paper_id}/modules/framing/answer",
            json={"answer": answer},
        )

    framing = client.get(f"{PREFIX}/papers/{paper_id}").json()["modules"]["framing"]
    assert len(framing["rounds"]) == 1
    assert framing["rounds"][0]["answer"] == "Second attempt."
    assert framing["rounds"][0]["revisions"] == ["First attempt."]


def test_hint_and_summary_are_module_local(client: TestClient) -> None:
    paper_id = _upload(client)["paper_id"]

    hint = client.post(f"{PREFIX}/papers/{paper_id}/modules/framing/hint").json()
    assert hint["hint"]
    assert hint["hint_evidence"][0]["section"] == "2 Related Work"

    summary = client.post(
        f"{PREFIX}/papers/{paper_id}/modules/framing/summary"
    ).json()
    assert summary["summary"]["mastered"] == ["the gap"]

    other = client.get(f"{PREFIX}/papers/{paper_id}").json()["modules"]["implementation"]
    assert other["hint"] == ""
    assert other["summary"] is None


def test_empty_answer_is_refused(client: TestClient) -> None:
    paper_id = _upload(client)["paper_id"]
    response = client.post(
        f"{PREFIX}/papers/{paper_id}/modules/framing/answer",
        json={"answer": "   "},
    )
    assert response.status_code == 400


def test_unknown_module_is_not_found(client: TestClient) -> None:
    paper_id = _upload(client)["paper_id"]
    response = client.post(
        f"{PREFIX}/papers/{paper_id}/modules/nonsense/answer",
        json={"answer": "x"},
    )
    assert response.status_code == 404


def test_a_plan_without_an_answer_cannot_advance(client: TestClient) -> None:
    paper_id = _upload(client)["paper_id"]
    response = client.post(f"{PREFIX}/papers/{paper_id}/modules/framing/advance")
    assert response.status_code == 400


def test_a_model_failure_is_an_actionable_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    paper_id = _upload(client)["paper_id"]

    async def _boom(**_kwargs):
        raise LLMError("rate limited", provider="test")

    monkeypatch.setattr(grader, "grade_answer", _boom)
    response = client.post(
        f"{PREFIX}/papers/{paper_id}/modules/framing/answer",
        json={"answer": "An answer."},
    )

    assert response.status_code == 503
    assert "Settings" in response.json()["detail"]
