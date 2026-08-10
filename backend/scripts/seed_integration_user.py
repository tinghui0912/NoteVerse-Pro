"""Create the deterministic local account used by Docker integration tests."""

from __future__ import annotations

import asyncio
import hashlib

from sqlmodel import select

from app.core.security import get_password_hash
from app.db.models import Score, ScoreRevision, ScoreRevisionSource, User
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.db.session import AsyncSessionLocal
from app.storage import file_storage


INTEGRATION_EMAIL = "integration@example.com"
INTEGRATION_PASSWORD = "IntegrationPass123!"
INTEGRATION_PRACTICE_SCORE_ID = "integration-practice-score"
INTEGRATION_PRACTICE_REVISION_ID = "integration-practice-revision"
INTEGRATION_MUSICXML = b'''<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Integration</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
</score-partwise>'''


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
        await session.flush()

        score = (
            await session.exec(
                select(Score).where(Score.score_uuid == INTEGRATION_PRACTICE_SCORE_ID)
            )
        ).one_or_none()
        if score is None:
            score = Score(
                score_uuid=INTEGRATION_PRACTICE_SCORE_ID,
                owner_user_id=user.id,
                title="Integration practice score",
            )
            session.add(score)
            await session.flush()
            revision = ScoreRevision(
                revision_uuid=INTEGRATION_PRACTICE_REVISION_ID,
                score_id=score.id,
                revision_number=1,
                content_hash=hashlib.sha256(INTEGRATION_MUSICXML).hexdigest(),
                origin=RevisionOrigin.IMPORT,
                created_by_user_id=user.id,
            )
            session.add(revision)
            await session.flush()
            storage_key = (
                f"scores/{score.score_uuid}/revisions/{revision.revision_uuid}/score.musicxml"
            )
            stored = file_storage.put_bytes(
                key=storage_key,
                content=INTEGRATION_MUSICXML,
                content_type="application/vnd.recordare.musicxml+xml",
            )
            session.add(
                ScoreRevisionSource(
                    source_uuid="integration-practice-source",
                    revision_id=revision.id,
                    format=RevisionSourceFormat.MUSICXML,
                    storage_backend=file_storage.backend_name,
                    storage_key=stored.storage_key,
                    filename=stored.filename,
                    mime_type="application/vnd.recordare.musicxml+xml",
                    size_bytes=stored.size_bytes,
                    sha256=hashlib.sha256(INTEGRATION_MUSICXML).hexdigest(),
                    generator="integration-fixture",
                    generator_version="1",
                )
            )
            score.head_revision_id = revision.id
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed_user())
