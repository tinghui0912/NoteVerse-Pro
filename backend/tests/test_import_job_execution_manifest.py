from sqlalchemy.orm import Session
from sqlmodel import SQLModel, select

from tests.support.import_execution import processing_lease

from app.db.execution_manifests import manifest_sha256
from app.db.models import ExecutionManifest, ImportJob, ImportJobState, User
from app.modules.import_jobs import execution_manifest
from app.modules.import_jobs.service import ImportJobService


def _job(job_uuid: str) -> ImportJob:
    return ImportJob(job_uuid=job_uuid, user_id=1, state=ImportJobState.QUEUED)


def _manifest(commit: str = "abc123") -> dict[str, object]:
    return {
        "schema_version": 1,
        "kind": "omr",
        "engine": "legato",
        "legato_commit": commit,
        "model": "guangyangmusic/legato",
        "processor": "guangyangmusic/legato",
    }


def test_execution_manifest_digest_is_stable_for_equivalent_content() -> None:
    assert manifest_sha256(_manifest()) == manifest_sha256(
        dict(reversed(list(_manifest().items())))
    )


def test_import_jobs_reuse_one_execution_manifest_and_preserve_first_binding(
    postgres_engine, monkeypatch
) -> None:
    engine = postgres_engine
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(execution_manifest, "build_omr_manifest", _manifest)

    with Session(engine) as session:
        session.add(User(id=1, email="manifest@example.test", password_hash="hash"))
        session.commit()
        first_job = _job("job-first")
        second_job = _job("job-second")
        session.add_all((first_job, second_job))
        session.commit()

        execution_manifest.bind_import_job_execution_manifest(
            session, processing_lease(session, first_job)
        )
        execution_manifest.bind_import_job_execution_manifest(
            session, processing_lease(session, second_job)
        )

        manifests = list(session.scalars(select(ExecutionManifest)))
        session.refresh(first_job)
        session.refresh(second_job)
        assert len(manifests) == 1
        assert (
            first_job.execution_manifest_id == second_job.execution_manifest_id == manifests[0].id
        )

        monkeypatch.setattr(
            execution_manifest, "build_omr_manifest", lambda: _manifest("different")
        )
        execution_manifest.bind_import_job_execution_manifest(
            session, processing_lease(session, first_job)
        )
        session.refresh(first_job)
        assert first_job.execution_manifest_id == manifests[0].id
        assert len(list(session.scalars(select(ExecutionManifest)))) == 1


def test_import_job_detail_exposes_manifest_digest_without_manifest_contents(
    postgres_engine,
    monkeypatch,
) -> None:
    engine = postgres_engine
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(execution_manifest, "build_omr_manifest", _manifest)

    with Session(engine) as session:
        session.add(User(id=1, email="manifest@example.test", password_hash="hash"))
        session.commit()
        job = _job("job-detail")
        session.add(job)
        session.commit()
        execution_manifest.bind_import_job_execution_manifest(
            session, processing_lease(session, job)
        )

        detail = (ImportJobService().detail(session, job.job_uuid, 1)).model_dump()
        assert detail["execution_manifest_sha256"] == manifest_sha256(_manifest())
        assert "execution_manifest" not in detail
