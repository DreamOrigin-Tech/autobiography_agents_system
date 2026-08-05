from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any


class BookPdfDependencyError(RuntimeError):
    pass


try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4, A5
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in environments missing reportlab
    colors = None
    TA_CENTER = TA_LEFT = TA_RIGHT = 0
    A4 = A5 = None
    mm = 1
    pdfmetrics = None
    UnicodeCIDFont = None
    TTFont = None
    PageBreak = Paragraph = SimpleDocTemplate = Spacer = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    _REPORTLAB_IMPORT_ERROR = exc
else:
    _REPORTLAB_IMPORT_ERROR = None


FONT_NAME = "BookCJK"
CID_FALLBACK_FONT = "STSong-Light"
FONT_CANDIDATES = [
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]


@dataclass(frozen=True)
class BookChapter:
    order: int
    title: str
    content_md: str


@dataclass(frozen=True)
class BookPdfData:
    title: str
    chapters: list[BookChapter]
    style_notes: str | None = None
    generated_at: datetime | None = None


def build_book_pdf(data: BookPdfData, layout: dict[str, Any]) -> bytes:
    if _REPORTLAB_IMPORT_ERROR is not None:
        raise BookPdfDependencyError("缺少 PDF 生成依赖 reportlab，请安装后重试。") from _REPORTLAB_IMPORT_ERROR
    if not data.chapters:
        raise ValueError("至少完成一个章节后才能导出 PDF。")

    font_name = _register_fonts()
    buffer = BytesIO()
    pagesize = A4 if layout.get("trim_size") == "A4" else A5
    margin = 20 * mm if pagesize == A5 else 24 * mm
    doc = SimpleDocTemplate(
        buffer,
        pagesize=pagesize,
        rightMargin=margin,
        leftMargin=margin,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=data.title,
        author="Autobiography Agents System",
    )

    styles = _build_styles(layout, font_name)
    story: list[Any] = []
    _append_title_page(story, data, layout, styles)
    if layout.get("include_preface", True):
        _append_preface(story, layout, styles)
    if layout.get("include_toc", True):
        _append_toc(story, data.chapters, styles)
    for chapter in data.chapters:
        _append_chapter(story, chapter, layout, styles)

    canvas_maker = _page_canvas_factory(data.title, layout, font_name)
    doc.build(story, onFirstPage=canvas_maker, onLaterPages=canvas_maker)
    return buffer.getvalue()


def _register_fonts() -> str:
    if FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        font_path = _find_font_path()
        if font_path and TTFont is not None:
            pdfmetrics.registerFont(TTFont(FONT_NAME, font_path))
            return FONT_NAME
    if FONT_NAME in pdfmetrics.getRegisteredFontNames():
        return FONT_NAME
    if CID_FALLBACK_FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont(CID_FALLBACK_FONT))
    return CID_FALLBACK_FONT


def _find_font_path() -> str | None:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


def _build_styles(layout: dict[str, Any], font_name: str) -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    body_size = float(layout.get("body_font_size", 10.5))
    leading = body_size * float(layout.get("line_spacing", 1.55))
    accent = _accent_color(layout.get("tone", "classic"))
    return {
        "title": ParagraphStyle(
            "BookTitle",
            parent=sample["Title"],
            fontName=font_name,
            fontSize=24,
            leading=31,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#1f2937"),
            spaceAfter=12,
        ),
        "subtitle": ParagraphStyle(
            "BookSubtitle",
            parent=sample["Normal"],
            fontName=font_name,
            fontSize=11,
            leading=17,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#667085"),
        ),
        "preface_title": ParagraphStyle(
            "PrefaceTitle",
            parent=sample["Heading1"],
            fontName=font_name,
            fontSize=16,
            leading=24,
            alignment=TA_CENTER,
            textColor=accent,
            spaceAfter=16,
        ),
        "chapter_title": ParagraphStyle(
            "ChapterTitle",
            parent=sample["Heading1"],
            fontName=font_name,
            fontSize=18,
            leading=27,
            alignment=TA_LEFT,
            textColor=accent,
            spaceAfter=18,
        ),
        "heading": ParagraphStyle(
            "BodyHeading",
            parent=sample["Heading2"],
            fontName=font_name,
            fontSize=13,
            leading=20,
            textColor=colors.HexColor("#344054"),
            spaceBefore=8,
            spaceAfter=7,
        ),
        "body": ParagraphStyle(
            "BookBody",
            parent=sample["BodyText"],
            fontName=font_name,
            fontSize=body_size,
            leading=leading,
            firstLineIndent=2 * body_size,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#1f2937"),
            spaceAfter=7,
        ),
        "toc": ParagraphStyle(
            "TocLine",
            parent=sample["Normal"],
            fontName=font_name,
            fontSize=10.5,
            leading=17,
            textColor=colors.HexColor("#344054"),
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=sample["Normal"],
            fontName=font_name,
            fontSize=8,
            leading=12,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#98a2b3"),
        ),
    }


def _append_title_page(story: list[Any], data: BookPdfData, layout: dict[str, Any], styles: dict[str, ParagraphStyle]) -> None:
    story.append(Spacer(1, 45 * mm))
    story.append(Paragraph(_escape(data.title), styles["title"]))
    if layout.get("subtitle"):
        story.append(Paragraph(_escape(str(layout["subtitle"])), styles["subtitle"]))
    story.append(Spacer(1, 18 * mm))
    story.append(Paragraph(f"共 {len(data.chapters)} 章", styles["small"]))
    if layout.get("design_note"):
        story.append(Spacer(1, 8 * mm))
        story.append(Paragraph(_escape(str(layout["design_note"])), styles["small"]))
    story.append(PageBreak())


def _append_preface(story: list[Any], layout: dict[str, Any], styles: dict[str, ParagraphStyle]) -> None:
    story.append(Paragraph(_escape(str(layout.get("preface_title") or "编者的话")), styles["preface_title"]))
    story.append(Paragraph(_escape(str(layout.get("preface") or "")), styles["body"]))
    story.append(PageBreak())


def _append_toc(story: list[Any], chapters: list[BookChapter], styles: dict[str, ParagraphStyle]) -> None:
    story.append(Paragraph("目录", styles["preface_title"]))
    for chapter in chapters:
        story.append(Paragraph(_escape(f"第{chapter.order}章  {chapter.title}"), styles["toc"]))
    story.append(PageBreak())


def _append_chapter(story: list[Any], chapter: BookChapter, layout: dict[str, Any], styles: dict[str, ParagraphStyle]) -> None:
    opening = f"第{chapter.order}章  {chapter.title}" if layout.get("chapter_opening") != "title_only" else chapter.title
    story.append(Paragraph(_escape(opening), styles["chapter_title"]))
    for kind, text in _markdown_blocks(chapter.content_md):
        if kind == "heading":
            story.append(Paragraph(_escape(text), styles["heading"]))
        else:
            story.append(Paragraph(_escape(text), styles["body"]))
    story.append(PageBreak())


def _markdown_blocks(markdown: str) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    current: list[str] = []

    def flush() -> None:
        if current:
            text = _clean_markdown_inline(" ".join(current))
            if text:
                blocks.append(("body", text))
            current.clear()

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            flush()
            continue
        if line.startswith("#"):
            flush()
            heading = re.sub(r"^#+\s*", "", line).strip()
            if heading:
                blocks.append(("heading", _clean_markdown_inline(heading)))
            continue
        current.append(line)
    flush()
    return blocks or [("body", _clean_markdown_inline(markdown))]


def _clean_markdown_inline(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_`>#-]+", "", text)
    return " ".join(text.split())


def _page_canvas_factory(project_title: str, layout: dict[str, Any], font_name: str):
    running_header = layout.get("running_header", "chapter_title")

    def draw(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFont(font_name, 8)
        canvas.setFillColor(colors.HexColor("#98a2b3"))
        page_width, _ = doc.pagesize
        header = project_title if running_header == "project_title" else project_title
        if doc.page > 1:
            canvas.drawString(doc.leftMargin, doc.height + doc.topMargin + 4 * mm, header[:36])
            canvas.drawRightString(page_width - doc.rightMargin, 11 * mm, str(doc.page))
        canvas.restoreState()

    return draw


def _accent_color(tone: str):
    if tone == "warm":
        return colors.HexColor("#8a4b2a")
    if tone == "plain":
        return colors.HexColor("#344054")
    return colors.HexColor("#0f766e")


def _escape(value: str) -> str:
    return html.escape(value, quote=False)
