from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.chapter import Chapter


class Revision(Base):
    __tablename__ = "revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id"), nullable=False)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    diff_json: Mapped[str] = mapped_column(Text, nullable=False)
    content_before: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_after: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    chapter: Mapped["Chapter"] = relationship(back_populates="revisions")
