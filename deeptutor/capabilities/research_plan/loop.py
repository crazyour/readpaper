"""Research-plan interview loop-capability hooks.

A research plan is a document the learner wrote and now has to defend. The mode
exists so the assistant interviews them about it — asking the questions a
committee would — instead of summarising it back to them.

The capability contributes three things to the ordinary chat loop:

* a system block carrying the interview playbook (:func:`_load_prompts`);
* ``read_source`` mounted on the answer surface, fed from a dedicated index key
  (``research_plan_source_index``) so ``explore_context`` stays dormant — a
  forced "read everything relevant" pre-pass is the wrong posture here, because
  the model should decide itself which part of a long plan it needs to quote;
* a deterministic pre-pass digest of the plan's structure, folded into the turn
  seed without an LLM call. This is what lets the opening question card be
  grounded in the real document even on a weak model, and it costs nothing.
"""

from __future__ import annotations

from importlib import resources
import logging
import re
from typing import Any

import yaml

from deeptutor.capabilities.protocol import PromptBlock
from deeptutor.core.context import UnifiedContext
from deeptutor.core.tool_protocol import TOOL_EVENT_PROJECTION, ToolEventProjection

logger = logging.getLogger(__name__)

#: Truthy on a turn that selected this mode.
MODE_KEY = "research_plan_mode"

#: ``{source_id: full_text}`` for the plan(s) attached to the conversation.
#: Deliberately a different key from chat's ``source_index``: that one wakes
#: ``explore_context``'s forced pre-pass (see ``deeptutor.capabilities.
#: explore_context.capability``), which is the right posture for chat and the
#: wrong one for an interview.
SOURCE_INDEX_KEY = "research_plan_source_index"

#: Upper bound on the digest folded into the turn seed. A plan's structure is
#: what makes a question sharp; the full text is still reachable via
#: ``read_source``, so clipping here only bounds the seed.
DIGEST_MAX_CHARS = 6000
DIGEST_EXCERPT_CHARS = 1200
DIGEST_MAX_SECTIONS = 24

_PROMPT_CACHE: dict[str, dict[str, Any]] = {}

# A heading is a short line that looks like one: numbered, or naming a section
# a proposal is expected to have, in English or Chinese.
_NUMBERED_HEADING = re.compile(
    r"^\s*(?:第[一二三四五六七八九十百零\d]+[章节部分]|"
    r"[一二三四五六七八九十]+[、.．]|"
    r"(?:\d+\.)+\d*|\d+[、.．])\s*"
)
_KNOWN_HEADINGS = (
    "abstract",
    "摘要",
    "关键词",
    "keywords",
    "introduction",
    "引言",
    "绪论",
    "background",
    "研究背景",
    "研究现状",
    "literature review",
    "文献综述",
    "research question",
    "研究问题",
    "研究目标",
    "研究内容",
    "research objective",
    "methodology",
    "methods",
    "method",
    "研究方法",
    "研究方案",
    "技术路线",
    "实验设计",
    "研究计划",
    "进度安排",
    "时间安排",
    "timeline",
    "expected outcome",
    "预期成果",
    "预期结果",
    "创新点",
    "novelty",
    "contribution",
    "贡献",
    "limitation",
    "局限",
    "伦理",
    "ethics",
    "references",
    "参考文献",
    "致谢",
)
_HEADING_MAX_CHARS = 48


def _load_prompts(language: str) -> dict[str, Any]:
    lang = "zh" if str(language or "en").lower().startswith("zh") else "en"
    cached = _PROMPT_CACHE.get(lang)
    if cached is not None:
        return cached
    try:
        text = (
            resources.files(__package__)
            .joinpath("prompts", lang, "research_plan.yaml")
            .read_text(encoding="utf-8")
        )
        data = yaml.safe_load(text)
    except Exception:
        logger.warning("failed to load research_plan prompts (%s)", lang, exc_info=True)
        data = None
    result = data if isinstance(data, dict) else {}
    _PROMPT_CACHE[lang] = result
    return result


def _prompt(prompts: dict[str, Any], key: str) -> str:
    return str(prompts.get(key) or "").strip()


def _is_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > _HEADING_MAX_CHARS:
        return False
    # A heading does not end in sentence punctuation; a wrapped paragraph line
    # does.
    if stripped[-1] in "。，,.;；:：":
        return False
    if _NUMBERED_HEADING.match(stripped):
        return True
    lowered = stripped.casefold()
    return any(lowered.startswith(marker) for marker in _KNOWN_HEADINGS)


def _sections(text: str) -> list[tuple[str, int]]:
    """Return ``(heading, char_count)`` pairs for a plan's top-level sections.

    Deterministic and deliberately forgiving: a proposal's headings are
    detected by shape (numbered / a known section name), and everything before
    the first heading is reported as an untitled lead-in. Prose that does not
    use headings at all yields a single untitled section rather than nothing.
    """
    headings: list[tuple[str, int]] = []
    lines = (text or "").splitlines()
    lead_chars = 0
    current_heading = ""
    current_chars = 0

    for line in lines:
        if _is_heading(line):
            if current_heading or current_chars:
                headings.append(
                    (current_heading or ("Preamble" if not headings else ""), current_chars)
                )
            elif lead_chars:
                headings.append(("", lead_chars))
            current_heading = line.strip()
            current_chars = 0
            lead_chars = 0
            continue
        if current_heading:
            current_chars += len(line) + 1
        else:
            lead_chars += len(line) + 1

    if current_heading or current_chars:
        headings.append((current_heading, current_chars))
    elif lead_chars and not headings:
        headings.append(("", lead_chars))

    return [(name, chars) for name, chars in headings if name or chars][:DIGEST_MAX_SECTIONS]


def _build_digest(index: dict[str, str]) -> str:
    """Summarise the attached plan(s) for the turn seed, without an LLM call."""
    blocks: list[str] = []
    remaining = DIGEST_MAX_CHARS
    for source_id, text in index.items():
        body = str(text or "").strip()
        if not body or remaining <= 0:
            continue
        sections = _sections(body)
        section_lines = "\n".join(
            f"- {name or '(untitled lead-in)'} — {chars} chars" for name, chars in sections
        )
        excerpt = body[: min(DIGEST_EXCERPT_CHARS, remaining)].strip()
        remaining -= len(excerpt)
        block = (
            f"#### Plan `{source_id}` — {len(body)} chars, {len(sections)} section(s)\n"
            f"{section_lines}\n\n"
            f"Opening text:\n{excerpt}"
        )
        blocks.append(block[:remaining] if remaining > 0 else block)
    return "\n\n".join(blocks)


class ResearchPlanLoopCapability:
    """Turn-scoped integration for the research-plan interview."""

    name = "research_plan_qa"
    # ``read_source`` is mounted here rather than left to chat's
    # ``explore_context`` pre-pass: the interview reads the plan on its own
    # schedule, and its index lives under a separate metadata key so the
    # forced pre-pass never fires.
    owned_tools: tuple[str, ...] = ("read_source",)

    def is_active(self, context: UnifiedContext) -> bool:
        return bool(context.metadata.get(MODE_KEY))

    def system_block(
        self,
        context: UnifiedContext,
        *,
        language: str,
        prompts: dict[str, Any],
    ) -> PromptBlock | None:
        """Contribute the interview playbook, plus the plan's identity."""
        if not self.is_active(context):
            return None
        own = _load_prompts(language)
        index = self._source_index(context)
        if not index:
            missing = _prompt(own, "plan_missing")
            return PromptBlock("research_plan", missing) if missing else None
        playbook = _prompt(own, "playbook")
        if not playbook:
            return None
        names = ", ".join(f"`{sid}` ({len(text)} chars)" for sid, text in index.items())
        return PromptBlock(
            "research_plan",
            f"{playbook}\n\n{self._session_instruction(context)}\n\n"
            f"### This conversation's plan\n\nAttached: {names}.",
        )

    @staticmethod
    def _session_instruction(context: UnifiedContext) -> str:
        """Render the request's own configuration into the playbook.

        ``focus`` and ``questions_per_card`` are what the composer set; the
        model has to be told them in the system block because neither is a
        parameter of a tool it calls.
        """
        config = context.config_overrides or {}
        focus = str(config.get("focus") or "").strip()
        try:
            per_card = int(config.get("questions_per_card") or 3)
        except (TypeError, ValueError):
            per_card = 3
        lines = [
            "### This interview's settings",
            f"- Ask at most {per_card} question(s) per card.",
        ]
        if focus:
            lines.append(
                f"- The learner asked to be interviewed especially on: {focus}. "
                "Keep other gaps in mind, but lead with this one."
            )
        return "\n".join(lines)

    def augment_kwargs(
        self,
        tool_name: str,
        kwargs: dict[str, Any],
        context: UnifiedContext,
    ) -> dict[str, Any]:
        if not self.is_active(context):
            return kwargs
        if tool_name == "read_source":
            updated = dict(kwargs)
            updated["source_index"] = self._source_index(context)
            # The plan is server-owned context, not a model-authored argument;
            # keep the trace from echoing the whole document back.
            updated[TOOL_EVENT_PROJECTION] = ToolEventProjection()
            return updated
        return kwargs

    async def pre_loop(
        self,
        context: UnifiedContext,
        stream: Any,
        *,
        usage: Any = None,
    ) -> PromptBlock | None:
        """Fold a deterministic structural digest of the plan into the seed.

        No LLM call: this is what makes the opening question card grounded in
        the real document even before the model has called ``read_source``.
        """
        _ = stream, usage
        if not self.is_active(context):
            return None
        digest = _build_digest(self._source_index(context))
        if not digest:
            return None
        return PromptBlock("research_plan_digest", digest)

    def pre_loop_seed(self, context: UnifiedContext) -> str:
        _ = context
        return ""

    @staticmethod
    def _source_index(context: UnifiedContext) -> dict[str, str]:
        index = context.metadata.get(SOURCE_INDEX_KEY)
        if not isinstance(index, dict):
            return {}
        return {str(k): str(v) for k, v in index.items() if str(v or "").strip()}


__all__ = ["MODE_KEY", "SOURCE_INDEX_KEY", "ResearchPlanLoopCapability"]
