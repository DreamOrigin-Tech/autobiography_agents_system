import pytest

from app.agents.book_designer import fallback_book_layout, normalize_book_layout


def test_book_layout_normalization_keeps_values_in_safe_ranges():
    fallback = fallback_book_layout("我的自传", [{"order": 1, "title": "童年"}])

    layout = normalize_book_layout(
        {
            "subtitle": "很长" * 40,
            "tone": "loud",
            "trim_size": "poster",
            "body_font_size": 30,
            "line_spacing": 0.5,
            "chapter_opening": "unknown",
            "running_header": "unknown",
        },
        fallback,
    )

    assert layout["subtitle"] == fallback["subtitle"]
    assert layout["tone"] == "classic"
    assert layout["trim_size"] == "A5"
    assert layout["body_font_size"] == 12.5
    assert layout["line_spacing"] == 1.35
    assert layout["chapter_opening"] == "numbered"


def test_book_pdf_builder_outputs_pdf_bytes():
    pytest.importorskip("reportlab")
    pytest.importorskip("pypdf")

    from app.services.book_pdf import BookChapter, BookPdfData, build_book_pdf
    from pypdf import PdfReader
    from io import BytesIO

    layout = fallback_book_layout("我的自传", [{"order": 1, "title": "童年"}])
    pdf_bytes = build_book_pdf(
        BookPdfData(
            title="我的自传",
            chapters=[
                BookChapter(order=1, title="童年", content_md="# 老屋\n我记得老屋门口的树。"),
            ],
        ),
        layout,
    )

    assert pdf_bytes.startswith(b"%PDF")
    reader = PdfReader(BytesIO(pdf_bytes))
    assert len(reader.pages) >= 3
