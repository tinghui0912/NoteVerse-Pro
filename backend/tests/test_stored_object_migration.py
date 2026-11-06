"""Real PostgreSQL physical-fact backfill and current schema constraints."""

import hashlib

from alembic import command
import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.db.models import User, ImportJob
from app.db.models.import_job import ImportJobState
from app.utils.timezone import utc_now_naive
from tests.test_practice_bundle_migration import migration_database


def tables(engine):
    metadata = sa.MetaData()
    metadata.reflect(engine)
    return metadata.tables


def seed_objects(
    connection, old, *, key="shared", size=3, sha=None, mime="application/octet-stream"
):
    digest = sha or hashlib.sha256(b"abc").hexdigest()
    connection.execute(
        old["storage_blobs"]
        .insert()
        .values(
            id=1,
            blob_uuid="upload-object",
            storage_key=key,
            size_bytes=size,
            sha256=digest,
            mime_type=mime,
            filename="original.png",
            created_at=utc_now_naive(),
        )
    )
    connection.execute(
        old["uploads"]
        .insert()
        .values(
            id=1,
            upload_uuid="upload",
            blob_id=1,
            original_filename=None,
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
    )
    connection.execute(
        old["media_blobs"]
        .insert()
        .values(
            id=1,
            object_key=key,
            byte_size=size,
            sha256=digest,
            content_type=mime,
            created_at=utc_now_naive(),
        )
    )


def test_backfill_uses_exact_key_identity_and_preserves_upload_filename(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0055_take_score_timebase")
        old = tables(engine)
        with engine.begin() as db:
            seed_objects(db, old)
            db.execute(
                old["media_blobs"]
                .insert()
                .values(
                    id=2,
                    object_key="different-key",
                    byte_size=3,
                    sha256=hashlib.sha256(b"abc").hexdigest(),
                    content_type="application/octet-stream",
                    created_at=utc_now_naive(),
                )
            )
        command.upgrade(config, "head")
        current = tables(engine)
        with engine.begin() as db:
            objects = (
                db.execute(
                    sa.select(current["stored_objects"]).order_by(current["stored_objects"].c.id)
                )
                .mappings()
                .all()
            )
            assert {row["object_key"] for row in objects} == {"shared", "different-key"}
            assert len({row["sha256"] for row in objects}) == 1
            upload = db.execute(sa.select(current["uploads"])).mappings().one()
            assert upload["original_filename"] == "original.png"
            assert upload["stored_object_id"] == next(
                row["id"] for row in objects if row["object_key"] == "shared"
            )
            # The final physical contract permits empty bytes and repeated digests.
            empty = dict(
                object_key="empty",
                byte_size=0,
                sha256=hashlib.sha256(b"").hexdigest(),
                content_type="application/octet-stream",
            )
            db.execute(current["stored_objects"].insert().values(**empty))
            db.execute(
                current["stored_objects"].insert().values(**(empty | {"object_key": "other-empty"}))
            )
        with engine.begin() as db:
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(current["stored_objects"].insert().values(**empty))
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(
                        current["uploads"]
                        .insert()
                        .values(
                            upload_uuid="missing-object",
                            stored_object_id=999999,
                            original_filename="missing.png",
                            created_at=utc_now_naive(),
                            updated_at=utc_now_naive(),
                        )
                    )


@pytest.mark.parametrize(
    "field,value", [("byte_size", 4), ("sha256", "d" * 64), ("content_type", "audio/webm")]
)
def test_conflicting_locator_facts_fail_before_schema_changes(monkeypatch, field, value):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0055_take_score_timebase")
        old = tables(engine)
        with engine.begin() as db:
            seed_objects(db, old)
            db.execute(old["media_blobs"].update().values(**{field: value}))
        with pytest.raises(RuntimeError, match="conflicting physical facts"):
            command.upgrade(config, "head")
        assert "stored_objects" not in sa.inspect(engine).get_table_names()


def seed_import(engine, old, *, mime=None, size=3, sha=None):
    with engine.begin() as db:
        user = User(email="migration@example.com", display_name="Migration", password_hash="test")
        db.execute(
            old["users"]
            .insert()
            .values(id=1, **user.model_dump(exclude={"id", "avatar_object_id"}))
        )
        job = ImportJob(job_uuid="migration-job", user_id=1, state=ImportJobState.PENDING)
        db.execute(old["import_jobs"].insert().values(id=1, **job.model_dump(exclude={"id"})))
        db.execute(
            old["import_artifacts"]
            .insert()
            .values(
                id=1,
                artifact_uuid="artifact",
                job_id=1,
                kind="musicxml",
                storage_key="job/object",
                filename="score.xml",
                mime_type=mime,
                size_bytes=size,
                sha256=sha,
                created_at=utc_now_naive(),
            )
        )


@pytest.mark.parametrize("missing", ["size", "sha"])
def test_missing_import_facts_require_environment_recreation(monkeypatch, missing):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0055_take_score_timebase")
        old = tables(engine)
        seed_import(
            engine,
            old,
            size=None if missing == "size" else 3,
            sha=None if missing == "sha" else hashlib.sha256(b"abc").hexdigest(),
        )
        with pytest.raises(RuntimeError, match="unverifiable physical facts.*recreate"):
            command.upgrade(config, "head")
        assert "stored_objects" not in sa.inspect(engine).get_table_names()


def test_import_default_content_type_is_preserved(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0055_take_score_timebase")
        old = tables(engine)
        seed_import(engine, old, sha=hashlib.sha256(b"abc").hexdigest())
        command.upgrade(config, "head")
        current = tables(engine)
        with engine.connect() as db:
            row = db.execute(sa.select(current["stored_objects"])).mappings().one()
            assert row["byte_size"] == 3
            assert row["sha256"] == hashlib.sha256(b"abc").hexdigest()
            assert row["content_type"] == "application/octet-stream"


def test_avatar_without_verified_physical_facts_requires_recreation(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0055_take_score_timebase")
        old = tables(engine)
        with engine.begin() as db:
            user = User(email="avatar@example.com", display_name="Avatar", password_hash="test")
            db.execute(
                old["users"]
                .insert()
                .values(
                    id=1,
                    avatar_url="/api/v1/avatars/image.jpg",
                    **user.model_dump(exclude={"id", "avatar_object_id"}),
                )
            )
        with pytest.raises(RuntimeError, match="avatar bytes.*recreate"):
            command.upgrade(config, "head")
        assert "stored_objects" not in sa.inspect(engine).get_table_names()


def test_every_durable_representation_backfills_its_exact_reference(monkeypatch):
    from app.db.models import (
        Score,
        ScoreRevision,
        ScoreRevisionSource,
        ScoreRenderAsset,
        ScorePlaybackAsset,
        ImportArtifact,
        PracticeBundleRecord,
        PerformanceTake,
    )
    from app.db.models.score import RevisionOrigin, RevisionSourceFormat, RenderAssetKind
    from app.db.models.playback import PlaybackAssetKind
    from app.modules.performance_takes.manifest_persistence import manifest_to_row
    from tests.test_take_manifest import value

    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0055_take_score_timebase")
        old = tables(engine)
        with engine.begin() as db:
            seed_objects(db, old)

            def insert(model, **physical):
                table = old[model.__tablename__]
                data = {
                    key: item
                    for key, item in model.model_dump(exclude={"id"}).items()
                    if key in table.c
                }
                db.execute(table.insert().values(id=1, **data, **physical))

            insert(User(email="owners@example.com", display_name="Owners", password_hash="test"))
            insert(ImportJob(job_uuid="owners-job", user_id=1, state=ImportJobState.PENDING))
            insert(Score(score_uuid="owners-score", title="Owners", owner_user_id=1))
            insert(
                ScoreRevision(
                    revision_uuid="owners-revision",
                    score_id=1,
                    revision_number=1,
                    content_hash="semantic-content",
                    origin=RevisionOrigin.IMPORT,
                    created_by_user_id=1,
                )
            )
            digest = hashlib.sha256(b"abc").hexdigest()

            def physical(key):
                return dict(
                    storage_key=key,
                    size_bytes=3,
                    sha256=digest,
                    mime_type="application/octet-stream",
                )

            insert(
                ScoreRevisionSource(
                    source_uuid="notation",
                    revision_id=1,
                    format=RevisionSourceFormat.MUSICXML,
                    filename="score.xml",
                    generator="test",
                    generator_version="1",
                ),
                **physical("notation"),
            )
            insert(
                ScoreRenderAsset(
                    asset_uuid="render",
                    revision_id=1,
                    kind=RenderAssetKind.RENDERED_PAGE,
                    filename="page.svg",
                    page_number=1,
                    render_profile="default",
                    generator="test",
                    generator_version="1",
                ),
                **physical("render"),
            )
            insert(
                ScorePlaybackAsset(
                    asset_uuid="playback",
                    revision_id=1,
                    kind=PlaybackAssetKind.AUDIO,
                    filename="playback.wav",
                    source_fingerprint="semantic-fingerprint",
                    generator="test",
                    generator_version="1",
                ),
                **physical("playback"),
            )
            insert(
                ImportArtifact(
                    artifact_uuid="import", job_id=1, kind="musicxml", filename="import.xml"
                ),
                **physical("import"),
            )
            insert(
                PracticeBundleRecord(
                    bundle_id="bundle",
                    artifact_id="artifact",
                    artifact_schema_version=1,
                    status="READY",
                ),
                prepared_musicxml_object_key="bundle/notation",
                prepared_musicxml_sha256=digest,
                prepared_musicxml_byte_size=3,
                artifact_object_key="bundle/artifact",
                artifact_sha256=digest,
                artifact_byte_size=3,
            )
            insert(manifest_to_row(value()))
            insert(PerformanceTake(manifest_id=1), media_blob_id=1)
        command.upgrade(config, "head")
        current = tables(engine)
        with engine.connect() as db:
            for name, column, key in [
                ("uploads", "stored_object_id", "shared"),
                ("performance_takes", "recording_object_id", "shared"),
                ("import_artifacts", "stored_object_id", "import"),
                ("score_revision_sources", "stored_object_id", "notation"),
                ("score_render_assets", "stored_object_id", "render"),
                ("score_playback_assets", "stored_object_id", "playback"),
                ("practice_bundles", "prepared_musicxml_object_id", "bundle/notation"),
                ("practice_bundles", "artifact_object_id", "bundle/artifact"),
            ]:
                owner, objects = current[name], current["stored_objects"]
                row = (
                    db.execute(sa.select(objects).join(owner, owner.c[column] == objects.c.id))
                    .mappings()
                    .one()
                )
                assert row["object_key"] == key
                assert row["byte_size"] == 3 and row["sha256"] == digest
            assert db.scalar(sa.select(current["uploads"].c.original_filename)) == "original.png"
            assert db.scalar(sa.select(current["score_revision_sources"].c.filename)) == "score.xml"
