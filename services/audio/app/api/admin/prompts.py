"""管理端 — Prompt 模板 CRUD"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.prompt_template import PromptTemplate, PromptTemplateVersion
from app.schemas.admin import PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateResponse
from app.api.deps import get_admin_user

router = APIRouter(prefix="/admin/prompts", tags=["管理-Prompt模板"])


@router.get("", response_model=list[PromptTemplateResponse])
async def list_prompts(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(PromptTemplate).order_by(PromptTemplate.is_system.desc(), PromptTemplate.created_at))
    templates = result.scalars().all()
    return [_tpl_to_response(t) for t in templates]


@router.post("", response_model=PromptTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_prompt(
    req: PromptTemplateCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    tpl = PromptTemplate(
        name=req.name,
        description=req.description,
        category=req.category,
        template_text=req.template_text,
        variables=req.variables,
        is_system=False,
        created_by=admin.id,
        version=1,
    )
    db.add(tpl)
    await db.flush()

    # 保存版本
    version = PromptTemplateVersion(
        template_id=tpl.id,
        version=1,
        template_text=req.template_text,
        change_note="初始版本",
    )
    db.add(version)
    await db.commit()
    await db.refresh(tpl)
    return _tpl_to_response(tpl)


@router.get("/{template_id}", response_model=PromptTemplateResponse)
async def get_prompt(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(PromptTemplate).where(PromptTemplate.id == uuid.UUID(template_id)))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "模板不存在")
    return _tpl_to_response(tpl)


@router.put("/{template_id}", response_model=PromptTemplateResponse)
async def update_prompt(
    template_id: str,
    req: PromptTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(PromptTemplate).where(PromptTemplate.id == uuid.UUID(template_id)))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "模板不存在")

    if req.name is not None:
        tpl.name = req.name
    if req.description is not None:
        tpl.description = req.description
    if req.category is not None:
        tpl.category = req.category
    if req.variables is not None:
        tpl.variables = req.variables
    if req.is_active is not None:
        tpl.is_active = req.is_active

    # 模板正文变更 → 新增版本
    if req.template_text is not None and req.template_text != tpl.template_text:
        tpl.template_text = req.template_text
        tpl.version += 1
        version = PromptTemplateVersion(
            template_id=tpl.id,
            version=tpl.version,
            template_text=req.template_text,
            change_note=req.change_note or f"更新至 v{tpl.version}",
        )
        db.add(version)

    await db.commit()
    await db.refresh(tpl)
    return _tpl_to_response(tpl)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(PromptTemplate).where(PromptTemplate.id == uuid.UUID(template_id)))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "模板不存在")
    if tpl.is_system:
        raise HTTPException(400, "系统预设模板不可删除")
    await db.delete(tpl)
    await db.commit()


@router.get("/{template_id}/versions")
async def list_versions(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(
        select(PromptTemplateVersion)
        .where(PromptTemplateVersion.template_id == uuid.UUID(template_id))
        .order_by(PromptTemplateVersion.version.desc())
    )
    versions = result.scalars().all()
    return [
        {
            "id": str(v.id),
            "version": v.version,
            "template_text": v.template_text,
            "change_note": v.change_note,
            "created_at": v.created_at.isoformat() if v.created_at else "",
        }
        for v in versions
    ]


@router.post("/{template_id}/preview")
async def preview_prompt(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    """预览模板效果（使用示例数据渲染）"""
    result = await db.execute(select(PromptTemplate).where(PromptTemplate.id == uuid.UUID(template_id)))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "模板不存在")

    from app.services.prompt_service import render_prompt

    sample_context = {
        "transcript": "[00:00] (主持人) 大家好，今天我们来聊一个很有意思的话题...\n[01:30] (嘉宾) 我觉得这个问题的核心在于...",
        "transcript_plain": "大家好，今天我们来聊一个很有意思的话题...我觉得这个问题的核心在于...",
        "speakers": ["主持人", "嘉宾"],
        "duration": 3600,
        "duration_formatted": "1小时0分",
        "language": "zh",
        "user_instruction": "",
        "audio_title": "示例播客 #1",
    }

    rendered = render_prompt(tpl.template_text, sample_context)
    return {"rendered": rendered, "template_name": tpl.name}


def _tpl_to_response(tpl: PromptTemplate) -> PromptTemplateResponse:
    return PromptTemplateResponse(
        id=str(tpl.id),
        name=tpl.name,
        description=tpl.description,
        category=tpl.category,
        template_text=tpl.template_text,
        variables=tpl.variables,
        is_system=tpl.is_system,
        is_active=tpl.is_active,
        version=tpl.version,
        created_at=tpl.created_at.isoformat() if tpl.created_at else "",
        updated_at=tpl.updated_at.isoformat() if tpl.updated_at else "",
    )
