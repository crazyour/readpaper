"""Tests for the research-plan interview capability.

The capability has two halves: the mode marks the turn and runs the chat
pipeline, and the loop extension contributes the interview playbook, mounts
``read_source``, and folds a deterministic digest of the plan into the seed.
These tests cover the deterministic parts — the digest, the section detection,
the system block, and the kwargs injection — none of which need an LLM.
"""

from __future__ import annotations

from typing import Any

import pytest

from deeptutor.capabilities.research_plan.loop import (
    MODE_KEY,
    SOURCE_INDEX_KEY,
    ResearchPlanLoopCapability,
)
from deeptutor.core.context import UnifiedContext
from deeptutor.core.tool_protocol import TOOL_EVENT_PROJECTION

PLAN = """# 研究计划书：基于图神经网络的蛋白质功能预测

摘要
本文研究蛋白质功能预测问题，提出一种新的图神经网络方法。

## 1. 研究背景
蛋白质功能预测是生物信息学的核心问题之一。现有方法依赖序列特征，
忽略了结构信息。

## 2. 研究问题
如何在不依赖高质量结构的情况下，利用接触图预测蛋白质功能？

## 3. 研究方法
我们计划使用图注意力网络，在 AlphaFold 预测的接触图上训练。

## 4. 研究计划
第一年完成数据收集，第二年完成模型训练。

## 5. 预期成果
发表两篇论文。
"""


def _ctx(plan: str | None) -> UnifiedContext:
    metadata: dict[str, Any] = {MODE_KEY: True}
    if plan is not None:
        metadata[SOURCE_INDEX_KEY] = {"at-plan01": plan}
    return UnifiedContext(user_message="帮我看看这个计划书", metadata=metadata)


def test_inactive_turn_contributes_nothing():
    capability = ResearchPlanLoopCapability()
    assert capability.is_active(UnifiedContext()) is False
    assert capability.system_block(UnifiedContext(), language="en", prompts={}) is None
    assert capability.augment_kwargs("read_source", {}, UnifiedContext()) == {}


def test_active_turn_contributes_the_playbook():
    capability = ResearchPlanLoopCapability()
    context = _ctx(PLAN)
    assert capability.is_active(context) is True
    block = capability.system_block(context, language="en", prompts={})
    assert block is not None
    assert block.name == "research_plan"
    assert "Research plan interview" in block.content
    # The plan is named so the model knows which source id to read.
    assert "at-plan01" in block.content


def test_playbook_is_localised():
    capability = ResearchPlanLoopCapability()
    block = capability.system_block(_ctx(PLAN), language="zh", prompts={})
    assert block is not None
    assert "研究计划书访谈" in block.content


def test_missing_plan_contributes_the_no_plan_block():
    capability = ResearchPlanLoopCapability()
    block = capability.system_block(_ctx(None), language="en", prompts={})
    assert block is not None
    assert "no plan attached" in block.content


def test_session_settings_render_from_request_config():
    capability = ResearchPlanLoopCapability()
    context = _ctx(PLAN)
    context.config_overrides = {"focus": "methodology", "questions_per_card": 2}
    block = capability.system_block(context, language="en", prompts={})
    assert block is not None
    assert "at most 2 question(s)" in block.content
    assert "methodology" in block.content


def test_read_source_gets_the_plan_index():
    capability = ResearchPlanLoopCapability()
    context = _ctx(PLAN)
    kwargs = capability.augment_kwargs("read_source", {"source_id": "at-plan01"}, context)
    assert kwargs["source_index"] == {"at-plan01": PLAN}
    # Trace must not echo the whole plan back to the UI.
    assert TOOL_EVENT_PROJECTION in kwargs


def test_other_tools_are_untouched():
    capability = ResearchPlanLoopCapability()
    context = _ctx(PLAN)
    kwargs = capability.augment_kwargs("ask_user", {"questions": []}, context)
    assert kwargs == {"questions": []}


@pytest.mark.asyncio
async def test_pre_loop_folds_a_deterministic_digest():
    capability = ResearchPlanLoopCapability()
    block = await capability.pre_loop(_ctx(PLAN), stream=None)
    assert block is not None
    assert block.name == "research_plan_digest"
    # Section headings are detected, in document order.
    assert "研究背景" in block.content
    assert "研究方法" in block.content
    assert "预期成果" in block.content
    # The opening text is present so the first question can be grounded.
    assert "蛋白质功能预测" in block.content


@pytest.mark.asyncio
async def test_pre_loop_without_a_plan_returns_none():
    capability = ResearchPlanLoopCapability()
    assert await capability.pre_loop(_ctx(None), stream=None) is None


@pytest.mark.asyncio
async def test_digest_is_stable_across_calls():
    capability = ResearchPlanLoopCapability()
    first = await capability.pre_loop(_ctx(PLAN), stream=None)
    second = await capability.pre_loop(_ctx(PLAN), stream=None)
    assert first is not None and second is not None
    assert first.content == second.content


def test_digest_bounds_its_size():
    from deeptutor.capabilities.research_plan.loop import DIGEST_MAX_CHARS, _build_digest

    huge = "\n".join(f"## Section {i}\n" + ("x" * 500) for i in range(60))
    digest = _build_digest({"at-big": huge})
    # The cap applies to the excerpts, not the section list; the whole digest
    # must still be bounded enough to ride in a seed.
    assert len(digest) < DIGEST_MAX_CHARS + 4000


def test_plan_without_headings_still_yields_a_section():
    from deeptutor.capabilities.research_plan.loop import _sections

    sections = _sections("Just a paragraph of prose with no headings at all.")
    assert sections
    assert sections[0][0] == ""
    assert sections[0][1] > 0


def test_numbered_headings_are_detected():
    from deeptutor.capabilities.research_plan.loop import _sections

    sections = _sections("1. Introduction\nbody\n2.1 Methods\nbody\n3. Results\nbody")
    names = [name for name, _ in sections]
    assert "1. Introduction" in names
    assert "2.1 Methods" in names
    assert "3. Results" in names


# ----- mode: the forced opening card ---------------------------------------


def _run_mode(monkeypatch, context):
    """Run the mode against a fake pipeline and report its constructor kwargs."""
    from deeptutor.capabilities.research_plan import mode as mode_module

    captured: dict[str, Any] = {}

    class FakePipeline:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def run(self, ctx, stream):
            captured["ran"] = True

    monkeypatch.setattr(mode_module, "AgenticChatPipeline", FakePipeline)
    return captured


@pytest.mark.asyncio
async def test_interview_turn_forces_the_opening_card(monkeypatch):
    import asyncio

    from deeptutor.capabilities.research_plan.mode import ResearchPlanQACapability

    context = _ctx(PLAN)
    context.config_overrides = {"mode": "interview"}
    captured = _run_mode(monkeypatch, context)

    async def _noop(_event):
        return None

    await ResearchPlanQACapability().run(context, _noop)
    assert captured["ran"] is True
    assert captured["initial_tool_choice"] == "ask_user"
    assert context.metadata[MODE_KEY] is True


@pytest.mark.asyncio
async def test_qa_turn_does_not_force_a_card(monkeypatch):
    from deeptutor.capabilities.research_plan.mode import ResearchPlanQACapability

    context = _ctx(PLAN)
    context.config_overrides = {"mode": "qa"}
    captured = _run_mode(monkeypatch, context)

    async def _noop(_event):
        return None

    await ResearchPlanQACapability().run(context, _noop)
    assert captured["initial_tool_choice"] is None


@pytest.mark.asyncio
async def test_no_plan_means_no_forced_card(monkeypatch):
    from deeptutor.capabilities.research_plan.mode import ResearchPlanQACapability

    context = _ctx(None)
    context.config_overrides = {"mode": "interview"}
    captured = _run_mode(monkeypatch, context)

    async def _noop(_event):
        return None

    await ResearchPlanQACapability().run(context, _noop)
    assert captured["initial_tool_choice"] is None
