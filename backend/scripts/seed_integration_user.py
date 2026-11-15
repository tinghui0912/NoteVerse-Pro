"""Create the deterministic local account used by Docker integration tests.

This script may run against a long-lived development database. Existing
accounts and score resources are treated as preconfigured fixtures and are
validated only; they are never silently repaired or overwritten.
"""

from __future__ import annotations

import asyncio
import hashlib
import os

from sqlmodel import select

from app.core.security import get_password_hash
from app.db.models import Score, ScoreRevision, ScoreRevisionSource, User
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.modules.revisions.writer import (
    revision_writer,
    InitialRevisionWrite,
    PreparedRevisionSource,
)
from app.modules.storage_objects.writes import write_object_async
from app.modules.storage_usage.service import storage_usage_service
from app.db.models import StorageUsageCategory
from app.processing.musicxml.admission import admit_musicxml_document
from app.db.session import AsyncSessionLocal
from app.storage import object_storage, async_object_storage


INTEGRATION_EMAIL = "integration@example.com"
INTEGRATION_PASSWORD_ENV = "NOTEVERSE_INTEGRATION_PASSWORD"
INTEGRATION_PRACTICE_SCORE_ID = "integration-practice-score"
INTEGRATION_PRACTICE_REVISION_ID = "integration-practice-revision"
INTEGRATION_MUSICXML = b"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Integration</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
</score-partwise>"""


async def seed_user() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.exec(select(User).where(User.email == INTEGRATION_EMAIL))
        user = result.one_or_none()
        created_user = False
        if user is None:
            password = os.environ.get(INTEGRATION_PASSWORD_ENV)
            if not password:
                raise RuntimeError(
                    f"{INTEGRATION_PASSWORD_ENV} must be set to create "
                    f"{INTEGRATION_EMAIL}; refusing to use a hard-coded password."
                )
            user = User(
                email=INTEGRATION_EMAIL,
                display_name="Integration User",
                password_hash=get_password_hash(password),
                is_active=True,
            )
            session.add(user)
            created_user = True
        else:
            if not user.is_active:
                raise RuntimeError(
                    f"Preconfigured integration user {INTEGRATION_EMAIL} is inactive; "
                    "refusing to modify an existing development account."
                )
        await session.flush()

        score = (
            await session.exec(
                select(Score).where(Score.score_uuid == INTEGRATION_PRACTICE_SCORE_ID)
            )
        ).one_or_none()
        if score is None:
            if not created_user:
                raise RuntimeError(
                    f"Integration score {INTEGRATION_PRACTICE_SCORE_ID} is missing for "
                    f"existing user {INTEGRATION_EMAIL}; refusing to create resources "
                    "under a pre-existing development account."
                )
            content = admit_musicxml_document(INTEGRATION_MUSICXML)
            storage_key = f"scores/{INTEGRATION_PRACTICE_SCORE_ID}/revisions/{INTEGRATION_PRACTICE_REVISION_ID}/score.musicxml"
            if object_storage.exists(storage_key):
                raise RuntimeError(
                    "Integration canonical object already exists; refusing overwrite"
                )
            reservation = await storage_usage_service.reserve(
                session,
                user_id=user.id,
                category=StorageUsageCategory.SOURCE,
                bytes_count=len(content),
                reason="integration_fixture",
                object_type="score_revision_source",
            )
            try:
                await session.commit()
                stored = await write_object_async(
                    session,
                    async_object_storage,
                    key=storage_key,
                    content=content,
                    content_type="application/vnd.recordare.musicxml+xml",
                )
                score = Score(
                    score_uuid=INTEGRATION_PRACTICE_SCORE_ID,
                    owner_user_id=user.id,
                    title="Integration practice score",
                )
                session.add(score)
                await session.flush()
                prepared = PreparedRevisionSource(
                    INTEGRATION_PRACTICE_REVISION_ID,
                    stored,
                    hashlib.sha256(content).hexdigest(),
                    "integration-fixture",
                    "1",
                    reservation.reservation_id,
                )
                await session.run_sync(
                    lambda sync: revision_writer.write(
                        sync,
                        InitialRevisionWrite(
                            INTEGRATION_PRACTICE_SCORE_ID,
                            user.id,
                            prepared,
                            None,
                            "integration-initial",
                            RevisionOrigin.IMPORT,
                        ),
                    )
                )
                await session.commit()
            except Exception:
                await session.rollback()
                await storage_usage_service.release_reservation(session, reservation.reservation_id)
                await session.commit()
                raise
        else:
            if score.owner_user_id != user.id:
                raise RuntimeError(
                    f"Integration score {INTEGRATION_PRACTICE_SCORE_ID} is not owned by "
                    f"{INTEGRATION_EMAIL}; refusing to modify existing development data."
                )
            revision = (
                await session.exec(
                    select(ScoreRevision).where(
                        ScoreRevision.revision_uuid == INTEGRATION_PRACTICE_REVISION_ID,
                        ScoreRevision.score_id == score.id,
                    )
                )
            ).one_or_none()
            if revision is None:
                raise RuntimeError(
                    f"Integration revision {INTEGRATION_PRACTICE_REVISION_ID} is missing; "
                    "refusing to repair existing development data."
                )
            source = (
                await session.exec(
                    select(ScoreRevisionSource).where(
                        ScoreRevisionSource.revision_id == revision.id,
                        ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
                    )
                )
            ).one_or_none()
            if source is None:
                raise RuntimeError(
                    "Integration MusicXML source is missing; refusing to overwrite or "
                    "recreate existing score resources."
                )
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed_user())
