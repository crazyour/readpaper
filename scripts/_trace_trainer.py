"""Run a real multi-round interview and print how the question evolves.

Proves (or disproves) that the next question depends on the previous answer.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deeptutor.paper_trainer.service import advance_module, create_paper, submit_answer
from deeptutor.paper_trainer.store import PaperTrainerStore

ANSWERS = [
    # Round 1: only the symptom.
    "因为循环网络训练太慢，换掉它就能训得更快。",
    # Round 2: the mechanism, still without the necessity argument.
    "循环网络要沿着序列位置逐步算，第 t 步必须等第 t-1 步算完，所以一个训练样本内部无法并行；序列一长，能放进显存的 batch 就变小，长距离依赖也更难学。",
    # Round 3: a complete answer to whatever round 2 queued.
    "因为这种顺序性不是实现层面的常数因子问题，而是依赖链本身决定的：再快的 GPU 也只能缩短每一步，不能消除逐步等待。论文把 RNN 做到 state of the art 之后，剩下的瓶颈只能靠换范式解决，所以抛弃循环是必要的，而不是可选的技术升级。",
    # Round 4: deliberately vague again, to see whether difficulty drops.
    "不知道，大概是为了效果更好吧。",
]


async def main() -> None:
    store = PaperTrainerStore(Path("/tmp/trainer_trace.sqlite3"))
    data = Path("/tmp/trainer_sample.pdf").read_bytes()
    paper = await create_paper(store=store, filename="trainer_sample.pdf", data=data, language="zh")
    module = paper.modules["framing"]
    print("=" * 78)
    print(f"论文：{paper.title}")
    print(f"[第 1 问] {module.current_question}")

    for index, answer in enumerate(ANSWERS, start=1):
        state = await submit_answer(
            store=store,
            paper_id=paper.paper_id,
            module="framing",
            answer=answer,
            language="zh",
        )
        round_state = state.rounds[-1]
        feedback = round_state.feedback
        print("\n" + "-" * 78)
        print(f"回答 {index}：{answer[:60]}{'…' if len(answer) > 60 else ''}")
        print(f"判定：{feedback.understanding}")
        if feedback.gaps:
            print(f"主要缺口：{feedback.gaps[0][:100]}")
        next_q = feedback.next_question
        if next_q is None:
            print("→ 没有下一题（模块收尾）")
            break
        print(f"→ 下一问 focus：{next_q.focus}")
        print(f"→ 下一问：{next_q.question}")
        state = await advance_module(store=store, paper_id=paper.paper_id, module="framing")
        # Sanity: advance must not re-generate anything.
        assert state.current_question == next_q.question


asyncio.run(main())
