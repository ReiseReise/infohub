"""应用配置管理 — 从 .env 读取所有配置项"""

from pydantic_settings import BaseSettings
from pydantic import Field, field_validator, model_validator
from typing import Optional


class Settings(BaseSettings):
    # === 基础服务 ===
    database_url: str = "postgresql+asyncpg://audio_insight:password@localhost:5432/audio_insight"
    database_url_sync: str = "postgresql://audio_insight:password@localhost:5432/audio_insight"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "your-jwt-secret-key-change-me-to-random-string"

    # === 存储 ===
    storage_backend: str = "local"  # local | oss
    local_storage_path: str = "./uploads"
    oss_access_key_id: str = ""
    oss_access_key_secret: str = ""
    oss_bucket_name: str = ""
    oss_endpoint: str = "https://oss-cn-beijing.aliyuncs.com"
    oss_region: str = "cn-beijing"

    # === 通义听悟 ASR ===
    tingwu_access_key_id: str = ""
    tingwu_access_key_secret: str = ""
    tingwu_region: str = "cn-beijing"
    tingwu_app_key: str = ""

    # === 百炼 DashScope ===
    dashscope_api_key: str = ""
    ark_api_key: str = ""
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_model: str = ""
    doubao_endpoint_id: str = ""
    default_llm_endpoint_id: str = ""

    @field_validator(
        "dashscope_api_key", "openai_api_key", "anthropic_api_key",
        "google_api_key", "jimeng_api_key", "ark_api_key", "secret_key",
        mode="before",
    )
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v

    # === 其他 LLM ===
    openai_api_key: str = ""
    openai_api_base: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""

    # === 即梦 ===
    jimeng_api_key: str = ""

    # === 加密 ===
    encryption_key: str = ""
    audio_webhook_secret: str = ""
    internal_api_key: str = ""

    # === 应用配置 ===
    app_name: str = "听见智慧"
    app_env: str = "development"
    app_debug: bool = True
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    # === 初始管理员 ===
    admin_email: str = "admin@example.com"
    admin_password: str = "change-me-please"
    first_invite_code: str = "AUDIO-INSIGHT-2026"

    # === Celery ===
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # === CORS ===
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # === JWT ===
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7

    @model_validator(mode="after")
    def normalize_endpoint_aliases(self):
        primary = (self.default_llm_endpoint_id or "").strip()
        alias = (self.doubao_endpoint_id or "").strip()
        if not primary and alias.startswith("ep-"):
            self.default_llm_endpoint_id = alias
        return self

    @model_validator(mode="after")
    def validate_runtime_secrets(self):
        if self.app_env == "test":
            return self

        self._assert_secret("secret_key", self.secret_key, min_length=32, blocked={
            "your-jwt-secret-key-change-me-to-random-string",
            "dev_jwt_secret_change_me",
            "change_me_jwt_secret_at_least_32_chars",
        })
        self._assert_secret("admin_password", self.admin_password, min_length=16, blocked={
            "change-me-please",
        })
        self._assert_secret("first_invite_code", self.first_invite_code, min_length=20, blocked={
            "AUDIO-INSIGHT-2026",
        })
        self._assert_secret("audio_webhook_secret", self.audio_webhook_secret, min_length=32, blocked={
            "change_me_audio_webhook_secret",
        })
        self._assert_secret("internal_api_key", self.internal_api_key, min_length=32, blocked={
            "change_me_internal_api_key",
        })
        return self

    @staticmethod
    def _assert_secret(name: str, value: str, *, min_length: int, blocked: set[str]):
        normalized = value.strip() if isinstance(value, str) else ""
        if not normalized or len(normalized) < min_length or normalized in blocked:
            raise ValueError(f"{name} is missing or too weak; set a non-default value in .env before starting audio-service")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
