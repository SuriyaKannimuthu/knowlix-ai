"""Recursive, page-aware text chunking.

Text is split on the coarsest separator that keeps pieces under the size limit
(paragraphs, then lines, then sentences, then words), and the pieces are then
packed greedily into chunks with a character overlap. Chunks never span PDF
pages, so every chunk can be cited with a single page number.
"""

from dataclasses import dataclass

from app.services.parsing import PageText

SEPARATORS = ("\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ")


@dataclass(frozen=True)
class Chunk:
    text: str
    page: int | None
    chunk_index: int


def _split_recursive(text: str, size: int, separators: tuple[str, ...]) -> list[str]:
    if len(text) <= size:
        return [text]
    for position, separator in enumerate(separators):
        if separator not in text:
            continue
        parts = text.split(separator)
        pieces = [part + separator for part in parts[:-1]] + [parts[-1]]
        result: list[str] = []
        for piece in pieces:
            if not piece:
                continue
            if len(piece) > size:
                result.extend(_split_recursive(piece, size, separators[position + 1 :]))
            else:
                result.append(piece)
        return result
    # No separator left (e.g. one enormous token): hard split.
    return [text[i : i + size] for i in range(0, len(text), size)]


def split_text(text: str, size: int, overlap: int) -> list[str]:
    pieces = _split_recursive(text, size, SEPARATORS)
    chunks: list[str] = []
    window: list[str] = []
    window_len = 0

    for piece in pieces:
        if window and window_len + len(piece) > size:
            chunks.append("".join(window).strip())
            # Keep a tail of the previous chunk as overlap, as long as it still leaves room.
            while window and (window_len > overlap or window_len + len(piece) > size):
                window_len -= len(window.pop(0))
        window.append(piece)
        window_len += len(piece)

    if window:
        chunks.append("".join(window).strip())
    return [chunk for chunk in chunks if chunk]


def chunk_pages(pages: list[PageText], size: int, overlap: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    for page in pages:
        for text in split_text(page.text, size, overlap):
            chunks.append(Chunk(text=text, page=page.page, chunk_index=len(chunks)))
    return chunks
