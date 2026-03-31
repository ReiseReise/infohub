"""音频任务模型"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, BigInteger, Boolean, DateTime, ForeignKey, func, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base
import enum


class TaskStatus(str, enum.Enum):
    uploading = "uploading"
    transcribing = "transcribing"
    summarizing = "summarizing"
    generating = "generating"
    done = "done"
    failed = "failed"


class AudioTask(Base):
    __tablename__ = "audio_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        String(20), default=TaskStatus.uploading, nullable=False, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 音频文件信息
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_format: Mapped[str | None] = mapped_column(String(10), nullable=True)
    audio_duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 秒
    audio_file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 字节

    # 转写结果
    transcript_raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # LLM 萃取结果
    summary_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # 多模态生成结果
    multimodal_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # 处理配置
    prompt_template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompt_templates.id"), nullable=True
    )
    user_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    asr_model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # 费用估算
    asr_cost: Mapped[float | None] = mapped_column(nullable=True)
    llm_cost: Mapped[float | None] = mapped_column(nullable=True)

    # 标签
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)

    # 时间戳
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # relationships
    user = relationship("User", back_populates="tasks")
    prompt_template = relationship("PromptTemplate", lazy="selectin")
    usage_logs = relationship("UsageLog", back_populates="task", lazy="selectin")
