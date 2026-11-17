"""Import artifact mutation requires typed authority before any side effect."""

from enum import StrEnum
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError
from sqlmodel import SQLModel

from app.db.models import ImportArtifact, ImportArtifactKind, ImportJob, ImportJobState, User
from app.modules.import_jobs.pipeline import artifact_recorder
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
from app.modules.import_jobs.requested_options import encode_requested_options
from app.modules.storage_objects.persistence import object_from_bytes


class ForeignKind(StrEnum):
    MUSICXML = "review_musicxml"


@pytest.mark.parametrize("kind", ["review_musicxml", ForeignKind.MUSICXML, object(), None])
def test_artifact_mutation_requires_import_kind_before_io_or_adoption(monkeypatch, tmp_path, kind):
    sessions, writes = Mock(), Mock()
    monkeypatch.setattr(artifact_recorder, "SessionLocal", sessions)
    monkeypatch.setattr(artifact_recorder, "write_object", writes)
    path = tmp_path / "review.musicxml"
    path.write_bytes(b"<score-partwise/>")
    with pytest.raises(TypeError):
        artifact_recorder.replace_files(Mock(), kind, [str(path)])
    with pytest.raises(TypeError):
        artifact_recorder._build_file_item("job", kind, str(path), 1)
    repository, db = Mock(), Mock()
    with pytest.raises(TypeError):
        ImportExecutionRecorder(repository=repository).replace_artifacts(db, Mock(), kind, [])
    sessions.assert_not_called()
    writes.assert_not_called()
    assert db.mock_calls == repository.mock_calls == []


def test_import_artifact_persistence_uses_exact_lowercase_enum(postgres_engine):
    SQLModel.metadata.create_all(postgres_engine)
    with Session(postgres_engine) as db:
        labels = (
            db.execute(
                sa.text(
                    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid JOIN pg_namespace n ON t.typnamespace=n.oid WHERE t.typname='importartifactkind' AND n.nspname=current_schema() ORDER BY e.enumsortorder"
                )
            )
            .scalars()
            .all()
        )
        assert labels == ["review_musicxml"]
        assert not ImportJob.__table__.c.requested_options.nullable
        db.add(User(id=1, email="artifact@example.test", password_hash="hash"))
        db.flush()
        job = ImportJob(
            job_uuid="typed-artifact",
            user_id=1,
            state=ImportJobState.QUEUED,
            requested_options=encode_requested_options(None),
        )
        db.add(job)
        db.flush()
        for kind in ImportArtifactKind:
            blob = object_from_bytes(
                object_key=kind.value, content=b"xml", content_type="application/xml"
            )
            artifact = ImportArtifact(
                job_id=job.id, kind=kind, filename="output", stored_object=blob
            )
            db.add(artifact)
        db.commit()
        job_id = job.id
        db.expunge_all()
        artifacts = db.scalars(sa.select(ImportArtifact)).all()
        assert {artifact.kind for artifact in artifacts} == set(ImportArtifactKind)
        assert all(type(artifact.kind) is ImportArtifactKind for artifact in artifacts)
        assert (
            db.execute(sa.text("SELECT kind::text FROM import_artifacts ORDER BY kind"))
            .scalars()
            .all()
            == labels
        )
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(
                sa.text(
                    "INSERT INTO import_artifacts (artifact_uuid, job_id, kind, stored_object_id, filename, created_at) VALUES ('bad', :job, 'arbitrary', 1, 'bad', now())"
                ),
                {"job": job_id},
            )
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(
                sa.text("UPDATE import_jobs SET requested_options=NULL WHERE id=:id"),
                {"id": job_id},
            )


@pytest.mark.parametrize("kind", list(ImportArtifactKind))
def test_sqlite_artifact_enum_round_trip_is_typed(kind):
    engine = sa.create_engine("sqlite:///:memory:")
    table = ImportArtifact.__table__
    table.create(engine)
    try:
        with engine.begin() as connection:
            connection.execute(
                table.insert().values(
                    artifact_uuid="artifact",
                    job_id=1,
                    stored_object_id=1,
                    kind=kind,
                    filename="output",
                )
            )
            loaded = connection.scalar(sa.select(table.c.kind))
            assert loaded is kind
    finally:
        engine.dispose()


@pytest.mark.parametrize("paths", [[], ["one.xml", "two.xml"]])
def test_review_recording_admits_one_current_musicxml_before_io(monkeypatch, paths):
    sessions, writes = Mock(), Mock()
    monkeypatch.setattr(artifact_recorder, "SessionLocal", sessions)
    monkeypatch.setattr(artifact_recorder, "write_object", writes)
    with pytest.raises(ValueError, match="exactly one file"):
        artifact_recorder.replace_files(Mock(), ImportArtifactKind.REVIEW_MUSICXML, paths)
    sessions.assert_not_called()
    writes.assert_not_called()
