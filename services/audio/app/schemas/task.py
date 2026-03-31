"""任务相关 Schema"""

from pydantic import BaseModel, Field
from typing import Optional


class TaskCreateRequest(BaseModel):
    title: str = Field("", max_length=200)
    prompt_template_id: str | None = None
    user_instruction: str | None = None
    llm_model: str | None = None
    asr_model: str | None = None


class TaskResponse(BaseModel):
    id: str
    title: str
    status: str
    error_message: str | None = None
    audio_url: str | None = None
    audio_format: str | None = None
    audio_duration: int | None = None
    audio_file_size: int | None = None
    transcript_text: str | None = None
    transcript_raw: dict | None = None
    summary_result: dict | None = None
    multimodal_result: dict | None = None
    prompt_template_id: str | None = None
    user_instruction: str | None = None
    asr_model: str | None = None
    llm_model: str | None = None
    asr_cost: float | None = None
    llm_cost: float | None = None
    tags: list[str] | None = None
    processing_started_at: str | None = None
    processing_finished_at: str | None = None
    created_at: str
    updated_at: str
    source_kind: str | None = None
    source_url: str | None = None
    download_stage: str | None = None
    download_strategy: str | None = None
    storage_backend: str | None = None
    requested_asr_model: str | None = None
    effective_asr_model: str | None = None
    asr_mode: str | None = None
    asr_selection_reason: str | None = None
    fallback_provider: str | None = None
    fallback_reason: str | None = None
    failure_code: str | None = None
    failure_detail: str | None = None
    asr_status: str | None = None
    summary_status: str | None = None
    render_status: str | None = None
    task_integrity_status: str | None = None
    task_integrity_reason: str | None = None
    export_markdown: str | None = None

    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int
    page: int
    page_size: int
