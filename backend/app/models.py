"""ORM tables. Member is the single source of truth; its validated params are
stored as JSON. BOQ line items are computed on demand from members, so there is
no quantity to keep in sync. See project.md sections 3 & 5."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, default="Untitled Project")
    client: Mapped[str] = mapped_column(String, default="")
    location: Mapped[str] = mapped_column(String, default="")
    currency: Mapped[str] = mapped_column(String, default="INR")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    members: Mapped[list["Member"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    drawings: Mapped[list["Drawing"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    rates: Mapped[list["Rate"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Drawing(Base):
    __tablename__ = "drawings"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    filename: Mapped[str] = mapped_column(String)
    storage_path: Mapped[str] = mapped_column(String, default="")
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    is_vector: Mapped[bool] = mapped_column(Boolean, default=True)
    scale_per_page: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="uploaded")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    project: Mapped[Project] = relationship(back_populates="drawings")


class Member(Base):
    __tablename__ = "members"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    drawing_id: Mapped[int | None] = mapped_column(ForeignKey("drawings.id"), nullable=True)
    member_type: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String, default="")
    params: Mapped[dict] = mapped_column(JSON)          # full validated Member dict
    source: Mapped[str] = mapped_column(String, default="manual")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    project: Mapped[Project] = relationship(back_populates="members")


class Rate(Base):
    __tablename__ = "rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    category: Mapped[str] = mapped_column(String)        # concrete, rebar, ...
    unit: Mapped[str] = mapped_column(String, default="")
    rate: Mapped[float] = mapped_column(Float, default=0.0)
    description: Mapped[str] = mapped_column(String, default="")

    project: Mapped[Project] = relationship(back_populates="rates")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    role: Mapped[str] = mapped_column(String)            # user | assistant
    content: Mapped[str] = mapped_column(String)
    proposed: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
