"""Create the deterministic local account used by Docker integration tests."""

from __future__ import annotations

import asyncio

from sqlmodel import select

from app.core.security import get_password_hash
from app.db.models import User
from app.db.session import AsyncSessionLocal


INTEGRATION_EMAIL = "integration@example.com"
INTEGRATION_PASSWORD = "IntegrationPass123!"


async def seed_user() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.exec(select(User).where(User.email == INTEGRATION_EMAIL))
        user = result.one_or_none()
        if user is None:
            user = User(
                email=INTEGRATION_EMAIL,
                display_name="Integration User",
                password_hash=get_password_hash(INTEGRATION_PASSWORD),
                is_active=True,
            )
            session.add(user)
        else:
            user.password_hash = get_password_hash(INTEGRATION_PASSWORD)
            user.is_active = True
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed_user())
