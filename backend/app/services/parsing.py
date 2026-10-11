"""Turn uploaded files into cleaned text, page by page where the format has pages."""

import io
import re
import unicodedata
from dataclasses import dataclass

from docx import Document as DocxDocument
from pypdf import PdfReader
from pypdf.errors import PdfReadError

SUPPORTED_TYPES: dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "md": "text/markdown",
}


class ParsingError(Exception):
    """The file could not be turned into text. The message is safe to show users."""


@dataclass(frozen=True)
class PageText:
    page: int | None  # 1-based page number, or None for formats without pages
    text: str


def matches_signature(file_type: str, data: bytes) -> bool:
    """Cheap magic-byte check so a renamed binary is not parsed as something else."""
    if file_type == "pdf":
        return data[:1024].lstrip().startswith(b"%PDF-")
    if file_type == "docx":
        return data.startswith(b"PK\x03\x04")
    return b"\x00" not in data[:8192]


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\x00", "")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # re-join words hyphenated across lines
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if encoding == "utf-16" and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
            continue
        return text
    return data.decode("cp1252", errors="replace")


def parse_pdf(data: bytes) -> list[PageText]:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ParsingError("This PDF is password-protected.")
        pages = [
            PageText(page=number, text=clean_text(page.extract_text() or ""))
            for number, page in enumerate(reader.pages, start=1)
        ]
    except ParsingError:
        raise
    except (PdfReadError, ValueError, KeyError) as exc:
        raise ParsingError("This PDF appears to be damaged and could not be read.") from exc
    return pages


def parse_docx(data: bytes) -> list[PageText]:
    try:
        document = DocxDocument(io.BytesIO(data))
    except Exception as exc:  # python-docx raises a variety of zip/xml errors
        raise ParsingError("This DOCX file could not be read.") from exc

    blocks: list[str] = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name or "").lower() if paragraph.style else ""
        # Blank lines around headings give the chunker natural split points.
        blocks.append(f"\n{text}\n" if style.startswith(("heading", "title")) else text)
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                blocks.append(" | ".join(cells))
    return [PageText(page=None, text=clean_text("\n\n".join(blocks)))]


def parse_text(data: bytes) -> list[PageText]:
    return [PageText(page=None, text=clean_text(_decode(data)))]


def parse_document(file_type: str, data: bytes) -> list[PageText]:
    if file_type == "pdf":
        pages = parse_pdf(data)
    elif file_type == "docx":
        pages = parse_docx(data)
    elif file_type in ("txt", "md"):
        pages = parse_text(data)
    else:
        raise ParsingError(f"Unsupported file type: {file_type}")

    pages = [page for page in pages if page.text]
    if not pages:
        hint = " It may be a scanned PDF, and OCR is not enabled." if file_type == "pdf" else ""
        raise ParsingError(f"No extractable text was found in this file.{hint}")
    return pages
