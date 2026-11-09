"""Research-plan interview loop capability.

``ResearchPlanQACapability`` (the *mode* the user picks) is deliberately NOT
re-exported here. It imports the agentic chat pipeline, which imports the
built-in tool registry — re-exporting the mode closes that cycle at interpreter
start, exactly as the reading and mastery packages document. The mode is loaded
lazily by class path from ``runtime.bootstrap.builtin_capabilities``.
"""

from deeptutor.capabilities.research_plan.loop import (
    MODE_KEY,
    SOURCE_INDEX_KEY,
    ResearchPlanLoopCapability,
)

__all__ = [
    "MODE_KEY",
    "SOURCE_INDEX_KEY",
    "ResearchPlanLoopCapability",
]
