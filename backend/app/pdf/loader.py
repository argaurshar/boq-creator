"""Open a vector PDF, render pages to PNG, extract text. Pre-AI, deterministic.

PyMuPDF is imported lazily so the rest of the app (and the engine tests) run
even when the binary wheel isn't installed.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass


@dataclass
class PageData:
    page_no: int
    width_pt: float
    height_pt: float
    text: str
    image_b64: str | None
    is_vector: bool


def _fitz():
    import fitz  # PyMuPDF
    return fitz


def open_pdf(path: str):
    return _fitz().open(path)


def page_count(path: str) -> int:
    doc = open_pdf(path)
    n = doc.page_count
    doc.close()
    return n


def render_page(path: str, page_no: int, dpi: int = 150) -> PageData:
    """Render one page (1-indexed) to text + a base64 PNG for AI vision."""
    fitz = _fitz()
    doc = fitz.open(path)
    page = doc[page_no - 1]
    text = page.get_text("text")
    # A page is "vector" if it has real text/drawings (not a flat scan).
    is_vector = bool(text.strip()) or bool(page.get_drawings())
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    image_b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
    data = PageData(
        page_no=page_no, width_pt=page.rect.width, height_pt=page.rect.height,
        text=text, image_b64=image_b64, is_vector=is_vector,
    )
    doc.close()
    return data


def detect_scale(text: str) -> str | None:
    """Cheap scale sniff from page text, e.g. '1:100'. None => ask the user."""
    import re
    m = re.search(r"\b1\s*[:/]\s*(\d{1,4})\b", text)
    return f"1:{m.group(1)}" if m else None
