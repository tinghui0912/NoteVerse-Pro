from sqlmodel import SQLModel, Session, create_engine, select

from app.db.models import ExecutionManifest, ImportJob, ImportJobState
from app.modules.import_jobs import execution_manifest


def _job(job_uuid: str) -> ImportJob:
    return ImportJob(job_uuid=job_uuid, user_id=1, state=ImportJobState.PENDING)


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
    assert execution_manifest.manifest_sha256(_manifest()) == execution_manifest.manifest_sha256(
        dict(reversed(list(_manifest().items())))
    )


def test_import_jobs_reuse_one_execution_manifest_and_preserve_first_binding(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(execution_manifest, "build_omr_manifest", _manifest)

    with Session(engine) as session:
        first_job = _job("job-first")
        second_job = _job("job-second")
        session.add_all((first_job, second_job))
        session.commit()

        execution_manifest.bind_import_job_execution_manifest(session, first_job.job_uuid)
        execution_manifest.bind_import_job_execution_manifest(session, second_job.job_uuid)

        manifests = list(session.exec(select(ExecutionManifest)))
        session.refresh(first_job)
        session.refresh(second_job)
        assert len(manifests) == 1
        assert (
            first_job.execution_manifest_id == second_job.execution_manifest_id == manifests[0].id
        )

        monkeypatch.setattr(
            execution_manifest, "build_omr_manifest", lambda: _manifest("different")
        )
        execution_manifest.bind_import_job_execution_manifest(session, first_job.job_uuid)
        session.refresh(first_job)
        assert first_job.execution_manifest_id == manifests[0].id
        assert len(list(session.exec(select(ExecutionManifest)))) == 1
