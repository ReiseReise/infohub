"""认证服务 — 注册、登录、JWT"""

from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.user import User, UserRole
from app.models.invite_code import InviteCode

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days)
    payload = {
        "sub": user_id,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError:
        return None


def _build_shadow_identity(user_id: str) -> tuple[str, str]:
    key = user_id.replace("-", "")[:12]
    return f"shadow_{key}", f"shadow+{key}@local.invalid"


async def ensure_auth_user_row(db: AsyncSession, user: User) -> None:
    """确保 auth.users 中存在与 JWT sub 一致的用户行，供 feed/audio 外键引用。"""
    user_id = str(user.id)
    now = datetime.now(timezone.utc)
    base_payload = {
        "id": user_id,
        "email": user.email,
        "username": user.username,
        "password_hash": user.password_hash,
        "role": user.role.value,
        "is_active": user.is_active,
        "created_at": user.created_at or now,
        "updated_at": now,
    }

    upsert_sql = text(
        """
        INSERT INTO auth.users (id, email, username, password_hash, role, is_active, created_at, updated_at)
        VALUES (:id, :email, :username, :password_hash, :role, :is_active, :created_at, :updated_at)
        ON CONFLICT (id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at
        """
    )

    try:
        async with db.begin_nested():
            await db.execute(upsert_sql, base_payload)
    except IntegrityError:
        # auth.users 中可能已存在同邮箱/用户名但不同 id 的历史记录。
        # 为保证 feed/audio 外键可落到当前 JWT sub，回退到 shadow 身份占位。
        shadow_username, shadow_email = _build_shadow_identity(user_id)
        shadow_payload = {
            **base_payload,
            "email": shadow_email,
            "username": shadow_username,
        }
        async with db.begin_nested():
            await db.execute(upsert_sql, shadow_payload)


async def register_user(
    db: AsyncSession,
    username: str,
    email: str,
    password: str,
    invite_code: str,
) -> User:
    # 验证邀请码
    result = await db.execute(select(InviteCode).where(InviteCode.code == invite_code))
    code_obj = result.scalar_one_or_none()
    if not code_obj:
        raise ValueError("邀请码无效")
    if code_obj.expires_at and code_obj.expires_at < datetime.now(timezone.utc):
        raise ValueError("邀请码已过期")
    if code_obj.used_count >= code_obj.max_uses:
        raise ValueError("邀请码已达使用上限")

    # 检查用户名/邮箱唯一
    existing = await db.execute(
        select(User).where((User.username == username) | (User.email == email))
    )
    if existing.scalar_one_or_none():
        raise ValueError("用户名或邮箱已存在")

    # 创建用户
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        role=UserRole.user,
        invite_code_used=invite_code,
    )
    db.add(user)
    await db.flush()
    await ensure_auth_user_row(db, user)

    # 更新邀请码使用次数
    code_obj.used_count += 1
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        return None
    if not user.is_active:
        return None
    # 更新最后活跃时间
    user.last_active_at = datetime.now(timezone.utc)
    await ensure_auth_user_row(db, user)
    await db.commit()
    return user


async def create_initial_admin(db: AsyncSession):
    """首次启动时创建管理员和初始邀请码"""
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.admin)
        .order_by(User.created_at.asc(), User.id.asc())
    )
    existing_admin = result.scalars().first()
    if existing_admin:
        await ensure_auth_user_row(db, existing_admin)
        await db.commit()
        return  # 已有管理员

    admin = User(
        username="admin",
        email=settings.admin_email,
        password_hash=hash_password(settings.admin_password),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(admin)
    await db.flush()
    await ensure_auth_user_row(db, admin)

    # 创建初始邀请码
    invite = InviteCode(
        code=settings.first_invite_code,
        created_by=admin.id,
        max_uses=50,
    )
    db.add(invite)
    await db.commit()
