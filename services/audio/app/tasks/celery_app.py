"""Celery 实例配置"""

from celery import Celery
import os
from app.config import settings

celery_app = Celery(
    "audio_insight",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="celery",
    task_soft_time_limit=int(os.getenv("CELERY_TASK_SOFT_LIMIT_SECONDS", "7200")),
    task_time_limit=int(os.getenv("CELERY_TASK_LIMIT_SECONDS", "7500")),
    task_routes={
        "asr_transcribe": {"queue": "asr"},
    },
)

celery_app.conf.update(
    include=["app.tasks.audio_pipeline"],
)
