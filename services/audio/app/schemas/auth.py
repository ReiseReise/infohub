"""认证相关 Schema"""

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=6)
    invite_code: str = Field(..., min_length=1, max_length=20)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    role: str
    is_active: bool
    quota_seconds_monthly: int = 7200
    created_at: str
    last_active_at: str | None = None

    model_config = {"from_attributes": True}
