"""AI 模型配置模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import enum


class ModelType(str, enum.Enum):
    asr = "asr"
    llm = "llm"
    multimodal = "multimodal"


class TestStatus(str, enum.Enum):
    untested = "untested"
    success = "success"
    failed = "failed"


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # alibaba/openai/anthropic/...
    alias: Mapped[str | None] = mapped_column(String(120), nullable=True)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    model_type: Mapped[ModelType] = mapped_column(String(20), nullable=False)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    extra_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    test_status: Mapped[TestStatus] = mapped_column(
        String(20), default=TestStatus.untested, nullable=False
    )
    test_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
