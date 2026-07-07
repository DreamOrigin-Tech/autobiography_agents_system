import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ChapterStatus(StrEnum):
    PENDING = "pending"
    INTERVIEWING = "interviewing"
    DRAFTING = "drafting"
    DONE = "done"


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default=ChapterStatus.PENDING)
    content_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    interview_topics: Mapped[str | None] = mapped_column(Text, nullable=True)
    reflection_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    topic_coverage: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship(back_populates="chapters")
    interview_sessions: Mapped[list["InterviewSession"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan"
    )
    revisions: Mapped[list["Revision"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan"
    )
