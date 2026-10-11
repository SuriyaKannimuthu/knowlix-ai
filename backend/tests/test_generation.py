from app.services.generation import (
    REFUSAL_MESSAGE,
    REFUSAL_SENTINEL,
    Generator,
    build_user_prompt,
    extract_citations,
    is_refusal,
    renumber_citations,
)
from app.services.retrieval import Candidate, reciprocal_rank_fusion
from app.services.vector_store import ScoredChunk


def passage(n: int, text: str = "text", page: int | None = None) -> Candidate:
    return Candidate(
        point_id=f"p{n}", document_id=f"d{n}", filename=f"doc{n}.pdf", page=page, chunk_index=n, text=text
    )


class FakeLLM:
    model = "fake-model"

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.prompts: list[tuple[str, str]] = []

    async def complete(self, system: str, user: str) -> tuple[str, int, int]:
        self.prompts.append((system, user))
        return self.reply, 120, 30


def test_citations_are_extracted_in_order_and_bounded() -> None:
    assert extract_citations("A [3]. B [1][3]. C [9].", passage_count=4) == [3, 1]


def test_renumbering_matches_returned_sources() -> None:
    assert renumber_citations("A [3]. B [1][3]. C [9].", [3, 1]) == "A [1]. B [2][1]. C ."


def test_refusal_detection() -> None:
    assert is_refusal(REFUSAL_SENTINEL)
    assert is_refusal(f" {REFUSAL_SENTINEL}. ")
    assert not is_refusal("The policy says economy [1].")


def test_prompt_numbers_passages_and_includes_pages() -> None:
    prompt = build_user_prompt("Q?", [passage(1, "alpha", page=4), passage(2, "beta")])
    assert "[1] (source: doc1.pdf, page 4)\nalpha" in prompt
    assert "[2] (source: doc2.pdf)\nbeta" in prompt
    assert prompt.rstrip().endswith("Answer with citations:")


async def test_llm_refusal_is_surfaced() -> None:
    result = await Generator(FakeLLM(REFUSAL_SENTINEL)).generate("Q?", [passage(1)])
    assert result.refused is True
    assert result.answer == REFUSAL_MESSAGE
    assert result.cited == []
    assert result.prompt_tokens == 120


async def test_llm_answer_is_renumbered_to_cited_passages() -> None:
    llm = FakeLLM("Economy for short flights [2]. Hotels capped [3][2].")
    result = await Generator(llm).generate("Q?", [passage(1), passage(2), passage(3)])
    assert result.refused is False
    assert result.cited == [2, 3]
    assert result.answer == "Economy for short flights [1]. Hotels capped [2][1]."
    assert "untrusted data" in llm.prompts[0][0]


async def test_uncited_llm_answer_keeps_all_passages() -> None:
    result = await Generator(FakeLLM("An answer without markers.")).generate("Q?", [passage(1), passage(2)])
    assert result.cited == [1, 2]


def test_reciprocal_rank_fusion_rewards_agreement() -> None:
    dense = [ScoredChunk("a", 0.9, {}), ScoredChunk("b", 0.8, {})]
    sparse = [ScoredChunk("b", 12.0, {}), ScoredChunk("c", 5.0, {})]
    fused = reciprocal_rank_fusion([dense, sparse], k=60)
    assert max(fused, key=fused.__getitem__) == "b"
    assert set(fused) == {"a", "b", "c"}
