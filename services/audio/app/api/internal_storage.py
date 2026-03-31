from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_internal_api_key
from app.database import get_db
from app.models.audio_task import AudioTask
from app.services.storage_service import get_storage

router = APIRouter(prefix="/internal/storage", tags=["internal-storage"])


class DeleteTaskStorageRequest(BaseModel):
    task_id: str = Field(..., min_length=1)


@router.post("/delete-task-audio", dependencies=[Depends(require_internal_api_key)])
async def delete_task_audio_storage(
    req: DeleteTaskStorageRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        task_uuid = UUID(req.task_id)
    except ValueError:
        return {"data": {"deleted": False, "reason": "invalid_task_id"}}

    task = await db.get(AudioTask, task_uuid)
    if not task:
        return {"data": {"deleted": False, "reason": "task_not_found"}}

    if not task.audio_url:
        return {"data": {"deleted": False, "reason": "no_audio_url"}}

    storage = get_storage()
    try:
        deleted = await storage.delete(task.audio_url)
    except Exception as exc:
        return {"data": {"deleted": False, "reason": str(exc) or "storage_delete_failed"}}

    return {"data": {"deleted": bool(deleted), "reason": None if deleted else "storage_delete_failed"}}
