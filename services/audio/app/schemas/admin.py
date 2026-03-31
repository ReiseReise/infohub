"""管理端相关 Schema"""

from pydantic import BaseModel, Field
from typing import Optional


# === 模型配置 ===

class ModelConfigCreate(BaseModel):
    provider: str
    alias: str | None = None
    model_name: str
    model_type: str  # asr | llm | multimodal
    api_key: str | None = None
    base_url: str | None = None
    extra_config: dict | None = None
    is_default: bool = False


class ModelConfigUpdate(BaseModel):
    provider: str | None = None
    alias: str | None = None
    model_name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    extra_config: dict | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ModelConfigResponse(BaseModel):
    id: str
    provider: str
    alias: str | None = None
    model_name: str
    model_type: str
    has_api_key: bool = False
    base_url: str | None = None
    extra_config: dict | None = None
    is_default: bool
    is_active: bool
    test_status: str
    test_message: str | None = None
    tested_at: str | None = None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


# === Prompt 模板 ===

class PromptTemplateCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: str | None = None
    category: str = "custom"
    template_text: str
    variables: list[str] | None = None


class PromptTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    template_text: str | None = None
    variables: list[str] | None = None
    is_active: bool | None = None
    change_note: str | None = None


class PromptTemplateResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    category: str
    template_text: str
    variables: list[str] | dict | None = None
    is_system: bool
    is_active: bool
    version: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


# === 邀请码 ===

class InviteCodeCreate(BaseModel):
    max_uses: int = 1
    expires_days: int | None = None


class InviteCodeResponse(BaseModel):
    id: str
    code: str
    max_uses: int
    used_count: int
    expires_at: str | None = None
    created_at: str

    model_config = {"from_attributes": True}


# === 用户管理 ===

class UserUpdateAdmin(BaseModel):
    is_active: bool | None = None
    role: str | None = None
    quota_seconds_monthly: int | None = None


# === 统计 ===

class StatsOverview(BaseModel):
    total_users: int
    active_users_today: int
    total_tasks: int
    tasks_today: int
    total_audio_hours: float
    estimated_cost_month: float
