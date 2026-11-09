"""Research-plan Q&A capability — the mode the user selects.

There is no bespoke pipeline: the standard agentic chat loop IS the interview.
This capability only marks the turn and runs that pipeline. Everything specific
to the mode is contributed by the loop capability
(:class:`deeptutor.capabilities.research_plan.loop.ResearchPlanLoopCapability`),
which mounts ``read_source``, injects the interview playbook, and folds a
deterministic digest of the uploaded plan into the seed.

The turn opens on a question card rather than a summary. The whole point of
the mode is that the learner is the one who has to explain their plan; a model
that answers first has already done the thinking for them.
"""

from __future__ import annotations

from typing import cast

from deeptutor.agents.chat.agentic_pipeline import AgenticChatPipeline
from deeptutor.capabilities.research_plan.loop import MODE_KEY, SOURCE_INDEX_KEY
from deeptutor.core.capability_protocol import StreamBusProtocol, TurnCapability
from deeptutor.core.context import UnifiedContext
from deeptutor.runtime.bootstrap.builtin_capabilities import builtin_capability_manifest
from deeptutor.runtime.stream_bus import StreamBus


class ResearchPlanQACapability(TurnCapability):
    """Interview the learner about an uploaded research plan."""

    manifest = builtin_capability_manifest("research_plan_qa")

    async def run(self, context: UnifiedContext, stream: StreamBusProtocol) -> None:
        context.metadata[MODE_KEY] = True
        # ``initial_tool_choice`` forces the first internal round to call
        # ``ask_user``, so the *interview* turn opens on the question card even
        # when the request text would otherwise tempt the model into a summary.
        # Later rounds — and every ``qa`` turn — return to model-directed
        # selection, which is what lets the student ask their own question and
        # get an answer instead of another card.
        #
        # Only with a plan actually attached: with nothing to interview them
        # about, forcing a card would put a question on screen instead of
        # simply saying no plan is attached.
        config = context.config_overrides or {}
        interview = str(config.get("mode") or "interview") == "interview"
        has_plan = bool(context.metadata.get(SOURCE_INDEX_KEY))
        pipeline = AgenticChatPipeline(
            language=context.language,
            initial_tool_choice="ask_user" if interview and has_plan else None,
        )
        await pipeline.run(context, cast(StreamBus, stream))


__all__ = ["ResearchPlanQACapability"]
