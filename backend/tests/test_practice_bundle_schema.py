"""Fresh PostgreSQL Bundle binding ownership and cascades."""

import sqlalchemy as sa
from alembic import command
from sqlmodel import SQLModel
from app.db.models import StoredObject, User, Score, ScoreRevision, ScoreRevisionPracticeBinding
from app.db.models.score import RevisionOrigin
from tests.support.postgres_schema import postgres_schema_database


def test_fresh_foundation_schema_matches_models_and_revision_ownership(monkeypatch):
    from sqlalchemy.orm import Session
    from app.db.models import PracticeBundleRecord

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        assert set(inspector.get_table_names()) == set(SQLModel.metadata.tables) | {
            "alembic_version"
        }
        for name in (
            "score_memberships",
            "score_invites",
        ):
            table = SQLModel.metadata.tables[name]
            assert {column["name"] for column in inspector.get_columns(name)} == set(
                table.columns.keys()
            )
        for name, targets in {
            "performance_take_manifests": {"users"},
            "performance_takes": {"scores", "performance_take_manifests", "stored_objects"},
            "performance_take_upload_reservations": {"users", "performance_take_manifests"},
        }.items():
            assert {fk["referred_table"] for fk in inspector.get_foreign_keys(name)} == targets
        with Session(engine) as db:
            user = User(email="schema@example.com", display_name="Schema", password_hash="test")
            db.add(user)
            db.flush()
            score = Score(score_uuid="score", title="Score", owner_user_id=user.id)
            db.add(score)
            db.flush()
            revision = ScoreRevision(
                revision_uuid="revision",
                score_id=score.id,
                revision_number=1,
                content_hash="d04b98f48e8f8bcc15c6ae5ac050801cd6dcfd428fb5f9e65c4e16e7807340fa",
                origin=RevisionOrigin.OMR,
                created_by_user_id=user.id,
            )
            db.add(revision)
            db.flush()
            source = PracticeBundleRecord(
                bundle_id="source",
                artifact_id="artifact",
                artifact_schema_version=1,
                prepared_musicxml_object=StoredObject(
                    object_key="xml",
                    sha256="a" * 64,
                    byte_size=10,
                    content_type="application/vnd.recordare.musicxml+xml",
                ),
                artifact_object=StoredObject(
                    object_key="json",
                    sha256="b" * 64,
                    byte_size=10,
                    content_type="application/json",
                ),
                status="READY",
            )
            db.add(source)
            db.flush()
            db.add(ScoreRevisionPracticeBinding(revision_id=revision.id, bundle_id=source.id))
            db.commit()
            db.delete(revision)
            db.commit()
            db.refresh(source)
            assert db.get(ScoreRevisionPracticeBinding, revision.id) is None


def test_current_bundle_creation_and_ready_tuples(monkeypatch):
    from datetime import timedelta
    import pytest
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import IntegrityError
    from app.db.models import PracticeBundleRecord
    from app.shared.time import utc_now

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add_all(
                [
                    StoredObject(
                        object_key=f"bundle/{i}",
                        byte_size=0,
                        sha256="a" * 64,
                        content_type="application/octet-stream",
                    )
                    for i in range(2)
                ]
            )
            db.commit()
            objects = list(db.scalars(sa.select(StoredObject.id).order_by(StoredObject.id)))
            expiry = utc_now() + timedelta(minutes=15)
            tuples = [
                ("CREATING", expiry, None, None, True),
                ("READY", None, *objects, True),
                ("CREATING", None, None, None, False),
                ("CREATING", expiry, *objects, False),
                ("CREATING", expiry, objects[0], None, False),
                ("READY", None, None, None, False),
                ("READY", expiry, *objects, False),
                ("READY", None, objects[0], None, False),
            ]
            for index, (status, lease, prepared, artifact, valid) in enumerate(tuples):
                with db.begin_nested() as transaction:
                    row = PracticeBundleRecord(
                        bundle_id=f"bundle-{index}",
                        artifact_id="artifact",
                        artifact_schema_version=1,
                        status=status,
                        creation_expires_at=lease,
                        prepared_musicxml_object_id=prepared,
                        artifact_object_id=artifact,
                    )
                    if valid:
                        db.add(row)
                        db.flush()
                    else:
                        with pytest.raises(IntegrityError):
                            db.add(row)
                            db.flush()
                    transaction.rollback()
