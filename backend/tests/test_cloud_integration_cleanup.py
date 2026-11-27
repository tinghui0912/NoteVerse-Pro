"""Cloud test teardown accepts explicit registered test responsibility only."""

from uuid import UUID, uuid4, uuid5
import pytest
from sqlalchemy.orm import Session
from app.db.models import ObjectWriteIntent, Score, User
from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.shared.time import utc_now
from tests.support.cloud_integration_cleanup import registered_keys


def test_cloud_teardown_preserves_unknown_resource_responsibility(postgres_engine):
    run = uuid4().hex
    with Session(postgres_engine) as db:
        db.add(
            ObjectWriteIntent(
                object_key="unrecognized/object",
                byte_size=1,
                sha256="a" * 64,
                content_type="text/plain",
                status=ObjectWriteIntentStatus.WRITE_UNKNOWN,
                write_token=str(uuid4()),
                write_expires_at=utc_now(),
            )
        )
        db.commit()
        with pytest.raises(RuntimeError, match="Unknown write IO"):
            registered_keys(db, run)
        assert db.query(ObjectWriteIntent).count() == 1


def test_cloud_teardown_rejects_a_different_run_owner(postgres_engine):
    with Session(postgres_engine) as db:
        db.add(User(id=1, email="test@example.test", password_hash="hash"))
        db.flush()
        db.add(Score(owner_user_id=1, score_uuid="another-owner", display_title="Other"))
        db.commit()
        with pytest.raises(RuntimeError, match="Unexpected Score ownership"):
            registered_keys(db, uuid4().hex)
        assert db.query(Score).count() == 1


def test_cloud_teardown_accepts_known_written_seed_before_business_commit(postgres_engine):
    run = uuid4().hex
    key = f"scores/{uuid5(UUID(run), 'score')}/revisions/{uuid5(UUID(run), 'revision')}/score.musicxml"
    with Session(postgres_engine) as db:
        db.add(
            ObjectWriteIntent(
                object_key=key,
                byte_size=1,
                sha256="a" * 64,
                content_type="text/plain",
                status=ObjectWriteIntentStatus.WRITTEN,
                write_token=str(uuid4()),
                write_expires_at=utc_now(),
            )
        )
        db.commit()
        assert registered_keys(db, run) == {key}
        with pytest.raises(ValueError):
            registered_keys(db, "invalid")


def test_cloud_teardown_does_not_delete_an_unregistered_seed_locator(postgres_engine):
    with Session(postgres_engine) as db:
        assert registered_keys(db, uuid4().hex) == set()
