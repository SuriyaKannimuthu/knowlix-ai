import pytest

from app.services.parsing import ParsingError, clean_text, matches_signature, parse_document
from tests.helpers import make_docx, make_pdf


def test_clean_text_normalizes_whitespace_and_hyphenation() -> None:
    raw = "Retrie-\nval   augmented\t\tgeneration\n\n\n\nNext   para "
    assert clean_text(raw) == "Retrieval augmented generation\n\nNext para"


def test_parse_pdf_keeps_page_numbers() -> None:
    pages = parse_document("pdf", make_pdf(["Quarterly revenue grew.", "Headcount stayed flat."]))
    assert [p.page for p in pages] == [1, 2]
    assert "revenue" in pages[0].text
    assert "Headcount" in pages[1].text


def test_parse_docx_includes_headings_paragraphs_and_tables() -> None:
    data = make_docx(
        "Travel policy",
        ["Economy class is required for flights under six hours."],
        table=[["Region", "Daily limit"], ["EU", "120 EUR"]],
    )
    [page] = parse_document("docx", data)
    assert page.page is None
    assert "Travel policy" in page.text
    assert "Economy class" in page.text
    assert "EU | 120 EUR" in page.text


def test_parse_text_handles_utf8_bom() -> None:
    [page] = parse_document("txt", "﻿Café menu".encode())
    assert page.text == "Café menu"


def test_blank_document_is_rejected() -> None:
    with pytest.raises(ParsingError, match="No extractable text"):
        parse_document("txt", b"   \n  ")


def test_damaged_pdf_is_rejected() -> None:
    with pytest.raises(ParsingError):
        parse_document("pdf", b"%PDF-1.4 this is not really a pdf")


@pytest.mark.parametrize(
    ("file_type", "data", "expected"),
    [
        ("pdf", b"%PDF-1.7\n...", True),
        ("pdf", b"hello", False),
        ("docx", b"PK\x03\x04rest", True),
        ("docx", b"%PDF-1.4", False),
        ("txt", b"plain text", True),
        ("txt", b"\x00\x01binary", False),
    ],
)
def test_signature_check(file_type: str, data: bytes, expected: bool) -> None:
    assert matches_signature(file_type, data) is expected
