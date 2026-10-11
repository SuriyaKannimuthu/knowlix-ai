from app.services.chunking import chunk_pages, split_text
from app.services.parsing import PageText


def test_short_text_is_a_single_chunk() -> None:
    assert split_text("A short paragraph.", size=200, overlap=20) == ["A short paragraph."]


def test_chunks_respect_size_and_overlap() -> None:
    sentences = [f"Sentence number {i} talks about topic {i}." for i in range(60)]
    text = " ".join(sentences)
    chunks = split_text(text, size=300, overlap=60)

    assert len(chunks) > 3
    assert all(len(chunk) <= 300 for chunk in chunks)
    # Consecutive chunks share some text (the overlap).
    for previous, current in zip(chunks, chunks[1:], strict=False):
        assert any(s in previous and s in current for s in sentences)
    # Nothing is lost.
    for sentence in sentences:
        assert any(sentence in chunk for chunk in chunks)


def test_prefers_paragraph_boundaries() -> None:
    first = "Alpha " * 30
    second = "Beta " * 30
    chunks = split_text(f"{first.strip()}\n\n{second.strip()}", size=200, overlap=0)
    assert chunks == [first.strip(), second.strip()]


def test_hard_splits_a_token_longer_than_the_chunk() -> None:
    chunks = split_text("x" * 1000, size=300, overlap=0)
    assert all(len(chunk) <= 300 for chunk in chunks)
    assert "".join(chunks) == "x" * 1000


def test_chunks_keep_page_numbers_and_never_span_pages() -> None:
    pages = [PageText(page=1, text="First page. " * 40), PageText(page=2, text="Second page. " * 40)]
    chunks = chunk_pages(pages, size=200, overlap=30)

    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert {c.page for c in chunks} == {1, 2}
    for chunk in chunks:
        assert ("First" in chunk.text) != ("Second" in chunk.text)
        assert chunk.page == (1 if "First" in chunk.text else 2)
