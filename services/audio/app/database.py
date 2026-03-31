"""数据库连接管理"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings


engine = create_async_engine(
    settings.database_url,
    echo=settings.is_development,
    pool_size=5,
    max_overflow=10,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("alter table usage_logs add column if not exists endpoint_id varchar(120)"))
        await conn.execute(text("alter table usage_logs add column if not exists total_tokens integer"))
        await conn.execute(text("alter table usage_logs add column if not exists latency_ms integer"))
        await conn.execute(text("alter table usage_logs add column if not exists provider_request_id varchar(120)"))
        await conn.execute(text("alter table usage_logs add column if not exists api_kind varchar(40)"))
        await conn.execute(text("alter table usage_logs add column if not exists prompt_preview text"))
        await conn.execute(text("alter table usage_logs add column if not exists response_preview text"))
        await conn.execute(text("alter table usage_logs add column if not exists label varchar(240)"))
        await conn.execute(text("alter table usage_logs add column if not exists error_message text"))
        await conn.execute(text("alter table model_configs add column if not exists alias varchar(120)"))
