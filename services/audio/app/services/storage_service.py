"""存储服务 — 本地文件 / 阿里云 OSS 双模式"""

import os
import uuid
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from datetime import datetime
from app.config import settings


class StorageProvider(ABC):
    """存储抽象接口"""

    @abstractmethod
    async def upload(self, file_data: bytes, filename: str, content_type: str = "") -> str:
        """上传文件，返回文件 URL/路径"""
        pass

    @abstractmethod
    async def download(self, file_path: str) -> bytes:
        """下载文件，返回字节数据"""
        pass

    @abstractmethod
    async def delete(self, file_path: str) -> bool:
        """删除文件"""
        pass

    @abstractmethod
    async def get_url(self, file_path: str, expires: int = 3600) -> str:
        """获取文件访问 URL（带签名或直接路径）"""
        pass


class LocalStorage(StorageProvider):
    """本地文件存储（开发环境）"""

    def __init__(self):
        self.base_path = Path(settings.local_storage_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _generate_path(self, filename: str) -> str:
        date_prefix = datetime.now().strftime("%Y/%m/%d")
        unique_name = f"{uuid.uuid4().hex[:8]}_{filename}"
        return f"{date_prefix}/{unique_name}"

    async def upload(self, file_data: bytes, filename: str, content_type: str = "") -> str:
        rel_path = self._generate_path(filename)
        full_path = self.base_path / rel_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(file_data)
        return rel_path

    async def download(self, file_path: str) -> bytes:
        full_path = self.base_path / file_path
        if not full_path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")
        return full_path.read_bytes()

    async def delete(self, file_path: str) -> bool:
        full_path = self.base_path / file_path
        if full_path.exists():
            full_path.unlink()
            return True
        return False

    async def get_url(self, file_path: str, expires: int = 3600) -> str:
        return f"/api/files/{file_path}"


class OSSStorage(StorageProvider):
    """阿里云 OSS 存储（生产环境）"""

    def __init__(self):
        import oss2
        auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
        self.bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket_name)

    def _generate_key(self, filename: str) -> str:
        date_prefix = datetime.now().strftime("%Y/%m/%d")
        unique_name = f"{uuid.uuid4().hex[:8]}_{filename}"
        return f"audio-insight/{date_prefix}/{unique_name}"

    async def upload(self, file_data: bytes, filename: str, content_type: str = "") -> str:
        key = self._generate_key(filename)
        headers = {}
        if content_type:
            headers["Content-Type"] = content_type
        self.bucket.put_object(key, file_data, headers=headers)
        return key

    async def download(self, file_path: str) -> bytes:
        result = self.bucket.get_object(file_path)
        return result.read()

    async def delete(self, file_path: str) -> bool:
        self.bucket.delete_object(file_path)
        return True

    async def get_url(self, file_path: str, expires: int = 7200) -> str:
        return self.bucket.sign_url("GET", file_path, expires, slash_safe=True)


def get_storage() -> StorageProvider:
    if settings.storage_backend == "oss":
        return OSSStorage()
    return LocalStorage()
