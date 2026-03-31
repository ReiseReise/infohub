"""多模态生成服务 — 万相 / 即梦图像生成"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from app.config import settings


@dataclass
class ImageResult:
    url: str
    prompt: str
    style: str = ""
    size: str = "1024x1024"


class MultimodalProvider(ABC):
    """多模态生成抽象接口"""

    @abstractmethod
    async def generate_image(
        self,
        prompt: str,
        style: str = "default",
        size: str = "1024x1024",
    ) -> ImageResult:
        pass


class WanxiangProvider(MultimodalProvider):
    """万相（阿里百炼 DashScope）文生图"""

    def __init__(self, api_key: str = ""):
        self.api_key = api_key or settings.dashscope_api_key

    async def generate_image(
        self,
        prompt: str,
        style: str = "default",
        size: str = "1024x1024",
    ) -> ImageResult:
        import dashscope
        from dashscope import ImageSynthesis

        dashscope.api_key = self.api_key

        response = ImageSynthesis.call(
            model="wanx2.1-t2i-turbo",
            prompt=prompt,
            n=1,
            size=size,
        )

        if response.status_code == 200 and response.output:
            results = response.output.get("results", [])
            if results:
                return ImageResult(
                    url=results[0].get("url", ""),
                    prompt=prompt,
                    style=style,
                    size=size,
                )

        raise RuntimeError(f"万相生图失败: {response}")


class JimengProvider(MultimodalProvider):
    """即梦（字节）文生图 — 需申请开发者权限"""

    def __init__(self, api_key: str = ""):
        self.api_key = api_key or settings.jimeng_api_key

    async def generate_image(
        self,
        prompt: str,
        style: str = "default",
        size: str = "1024x1024",
    ) -> ImageResult:
        import httpx

        # 即梦 API 接入（需根据实际 API 文档调整）
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://jimeng.jianying.com/api/v1/generate",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "prompt": prompt,
                    "style": style,
                    "width": int(size.split("x")[0]),
                    "height": int(size.split("x")[1]),
                },
                timeout=60,
            )
            response.raise_for_status()
            data = response.json()
            return ImageResult(
                url=data.get("url", ""),
                prompt=prompt,
                style=style,
                size=size,
            )


def get_multimodal_provider(provider: str = "wanxiang", **kwargs) -> MultimodalProvider:
    providers = {
        "wanxiang": WanxiangProvider,
        "jimeng": JimengProvider,
    }
    cls = providers.get(provider)
    if not cls:
        raise ValueError(f"未知多模态提供商: {provider}。可选: {list(providers.keys())}")
    return cls(**kwargs)
