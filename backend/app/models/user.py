from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.auth_session import AuthSession
    from app.models.project import Project


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), default="默认用户")
    auth_provider: Mapped[str] = mapped_column(String(32), default="local", server_default="local")
    provider_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    wechat_openid: Mapped[str | None] = mapped_column(
        String(128), unique=True, index=True, nullable=True
    )
    wechat_unionid: Mapped[str | None] = mapped_column(
        String(128), unique=True, index=True, nullable=True
    )
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    projects: Mapped[list["Project"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    auth_sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
