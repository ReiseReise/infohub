"""管理端 — 用户管理 + 邀请码"""

import uuid
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.models.invite_code import InviteCode
from app.schemas.admin import InviteCodeCreate, InviteCodeResponse, UserUpdateAdmin
from app.schemas.auth import UserResponse
from app.api.deps import get_admin_user

router = APIRouter(prefix="/admin", tags=["管理-用户"])


# === 用户管理 ===

@router.get("/users", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [
        UserResponse(
            id=str(u.id),
            username=u.username,
            email=u.email,
            role=u.role.value,
            is_active=u.is_active,
            quota_seconds_monthly=u.quota_seconds_monthly,
            created_at=u.created_at.isoformat() if u.created_at else "",
            last_active_at=u.last_active_at.isoformat() if u.last_active_at else None,
        )
        for u in users
    ]


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    req: UserUpdateAdmin,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "用户不存在")

    if req.is_active is not None:
        user.is_active = req.is_active
    if req.role is not None:
        user.role = UserRole(req.role)
    if req.quota_seconds_monthly is not None:
        user.quota_seconds_monthly = req.quota_seconds_monthly

    await db.commit()
    await db.refresh(user)
    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
        quota_seconds_monthly=user.quota_seconds_monthly,
        created_at=user.created_at.isoformat() if user.created_at else "",
        last_active_at=user.last_active_at.isoformat() if user.last_active_at else None,
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(400, "用户ID格式错误")

    if user_uuid == admin.id:
        raise HTTPException(400, "不能删除当前管理员账号")

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "用户不存在")

    await db.delete(user)

    # 尝试同步清理 auth.users（若存在该 schema）。
    auth_sync = "ok"
    try:
        await db.execute(
            text("DELETE FROM auth.users WHERE id = :uid"),
            {"uid": str(user_uuid)},
        )
    except Exception:
        auth_sync = "skipped"

    await db.commit()
    return {"message": "用户已删除", "user_id": user_id, "auth_sync": auth_sync}


# === 邀请码 ===

@router.post("/invite-codes", response_model=InviteCodeResponse, status_code=status.HTTP_201_CREATED)
async def create_invite_code(
    req: InviteCodeCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    code = f"AI-{secrets.token_hex(4).upper()}"
    expires_at = None
    if req.expires_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=req.expires_days)

    invite = InviteCode(
        code=code,
        created_by=admin.id,
        max_uses=req.max_uses,
        expires_at=expires_at,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    return InviteCodeResponse(
        id=str(invite.id),
        code=invite.code,
        max_uses=invite.max_uses,
        used_count=invite.used_count,
        expires_at=invite.expires_at.isoformat() if invite.expires_at else None,
        created_at=invite.created_at.isoformat() if invite.created_at else "",
    )


@router.get("/invite-codes", response_model=list[InviteCodeResponse])
async def list_invite_codes(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    result = await db.execute(select(InviteCode).order_by(InviteCode.created_at.desc()))
    codes = result.scalars().all()
    return [
        InviteCodeResponse(
            id=str(c.id),
            code=c.code,
            max_uses=c.max_uses,
            used_count=c.used_count,
            expires_at=c.expires_at.isoformat() if c.expires_at else None,
            created_at=c.created_at.isoformat() if c.created_at else "",
        )
        for c in codes
    ]
