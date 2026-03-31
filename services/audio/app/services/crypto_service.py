"""加密服务 — API Key 在数据库中加密存储"""

from base64 import urlsafe_b64encode
from functools import lru_cache
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _resolve_encryption_key() -> str:
    """优先使用 ENCRYPTION_KEY；缺失时回退到基于 SECRET_KEY 的派生密钥。"""
    key = (settings.encryption_key or "").strip()
    if key:
        return key

    secret = (settings.secret_key or "").strip()
    if not secret:
        raise ValueError("SECRET_KEY 未配置，无法生成加密密钥")

    logger.warning(
        "ENCRYPTION_KEY 未配置，已回退为基于 SECRET_KEY 的派生密钥。建议显式配置 ENCRYPTION_KEY。"
    )
    return urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest()).decode("utf-8")


def _get_fernet() -> Fernet:
    return Fernet(_resolve_encryption_key().encode("utf-8"))


def encrypt_api_key(plain_text: str) -> str:
    if not plain_text:
        return ""
    return _get_fernet().encrypt(plain_text.encode("utf-8")).decode("utf-8")


def decrypt_api_key(encrypted_text: str) -> str:
    if not encrypted_text:
        return ""

    try:
        return _get_fernet().decrypt(encrypted_text.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        # 兼容历史明文或密钥变更导致的旧数据，避免接口直接 500。
        logger.warning("模型 API Key 解密失败，按明文回退。请检查 ENCRYPTION_KEY/SECRET_KEY 是否一致。")
        return encrypted_text
