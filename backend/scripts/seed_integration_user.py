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
from app.db.session import AsyncSessionLocal
from app.storage import file_storage


INTEGRATION_EMAIL = "integration@example.com"
INTEGRATION_PASSWORD_ENV = "NOTEVERSE_INTEGRATION_PASSWORD"
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
            if file_storage.exists(storage_key):
                raise RuntimeError(
                    f"Integration score object already exists at {storage_key}; "
                    "refusing to overwrite existing development OSS data."
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
                        ScoreRevisionSource.source_uuid == "integration-practice-source",
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
