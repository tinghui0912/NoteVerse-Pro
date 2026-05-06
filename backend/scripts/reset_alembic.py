import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

async def reset_alembic():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        try:
            await conn.execute(text("DROP TABLE alembic_version"))
            print("Dropped alembic_version table.")
        except Exception as e:
            print(f"Error: {e}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(reset_alembic())
