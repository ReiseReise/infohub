"""WebSocket 任务进度推送"""

import uuid
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session
from app.models.audio_task import AudioTask, TaskStatus

logger = logging.getLogger(__name__)
router = APIRouter()

# 步骤映射：status → 进度百分比估算
STEP_PROGRESS = {
    TaskStatus.uploading: 5,
    TaskStatus.transcribing: 30,
    TaskStatus.summarizing: 60,
    TaskStatus.generating: 80,
    TaskStatus.done: 100,
    TaskStatus.failed: -1,
}

STEP_MESSAGES = {
    TaskStatus.uploading: "正在上传音频...",
    TaskStatus.transcribing: "正在转写音频...",
    TaskStatus.summarizing: "正在生成知识萃取...",
    TaskStatus.generating: "正在生成多模态内容...",
    TaskStatus.done: "处理完成",
    TaskStatus.failed: "处理失败",
}


@router.websocket("/ws/tasks/{task_id}")
async def task_progress_ws(websocket: WebSocket, task_id: str):
    await websocket.accept()
    logger.info(f"WebSocket 连接: task={task_id}")

    try:
        last_status = None
        poll_count = 0
        max_polls = 360  # 最多轮询 30 分钟（5s * 360）

        while poll_count < max_polls:
            async with async_session() as db:
                result = await db.execute(
                    select(AudioTask).where(AudioTask.id == uuid.UUID(task_id))
                )
                task = result.scalar_one_or_none()

            if not task:
                await websocket.send_json({
                    "type": "error",
                    "message": "任务不存在",
                })
                break

            current_status = task.status

            # 状态变化时推送
            if current_status != last_status:
                progress = STEP_PROGRESS.get(current_status, 0)
                message = STEP_MESSAGES.get(current_status, "处理中...")

                await websocket.send_json({
                    "type": "progress",
                    "step": current_status,
                    "progress": progress,
                    "message": message,
                    "error": task.error_message if current_status == TaskStatus.failed else None,
                })

                last_status = current_status

                # 终态退出
                if current_status in (TaskStatus.done, TaskStatus.failed):
                    break

            await asyncio.sleep(5)  # 每 5 秒轮询一次
            poll_count += 1

    except WebSocketDisconnect:
        logger.info(f"WebSocket 断开: task={task_id}")
    except Exception as e:
        logger.error(f"WebSocket 错误: task={task_id}, error={e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
