"""Real Session Import HTTP admission, bulk projection and idempotency."""

from app.modules.import_jobs.requested_options import encode_requested_options

from tests.support.storage_state import provision_storage_users

from app.shared.time import utc_now

from datetime import UTC


import asyncio
from threading import Barrier, Event
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest
from alembic import command
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ResourceNotFoundException
from app.db.execution_manifests import manifest_sha256
from app.db.models import (
    StorageUsageCategory,
    ExecutionManifest,
    ImportArtifact,
    ImportDispatch,
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    ImportJobUpload,
    Score,
    StoredObject,
    Upload,
    User,
)
from app.modules.storage_usage.service import storage_usage_service
from app.main import app
from app.db.models.import_job import ImportArtifactKind
from app.modules.import_jobs.schemas import ImportJobSubmitRequest
from app.modules.import_jobs.service import ImportJobService
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.shared.error_codes import CustomerErrorCode
from tests.support.postgres_schema import postgres_schema_database

NOW = datetime(2026, 11, 13, 1, 2, 3, 456789, tzinfo=UTC)
MANIFEST = {"schema_version": 1, "kind": "omr", "engine": "legato"}


@pytest.fixture
def postgres_url(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        yield engine.url.render_as_string(hide_password=False)


@pytest.fixture
def application_db(postgres_url, monkeypatch):

    engine = create_engine(postgres_url)
    try:
        with Session(engine, expire_on_commit=False) as db:
            db.add_all(
                [
                    User(id=1, email="owner@example.com", password_hash="hash"),
                    User(id=2, email="other@example.com", password_hash="hash"),
                    StoredObject(
                        id=1,
                        object_key="uploads/original",
                        byte_size=17,
                        content_type="image/png",
                        sha256="a" * 64,
                    ),
                    StoredObject(
                        id=2,
                        object_key="jobs/review.musicxml",
                        byte_size=23,
                        content_type="application/xml",
                        sha256="b" * 64,
                    ),
                ]
            )
            db.flush()
            provision_storage_users(db)
            db.add_all(
                [
                    Upload(
                        id=1,
                        upload_uuid="upload-a",
                        stored_object_id=1,
                        original_filename="page-a.png",
                        uploader_user_id=1,
                    ),
                    Upload(
                        id=2,
                        upload_uuid="upload-b",
                        stored_object_id=1,
                        original_filename="page-b.png",
                        uploader_user_id=1,
                    ),
                    Upload(
                        id=3,
                        upload_uuid="upload-other",
                        stored_object_id=1,
                        original_filename="other.png",
                        uploader_user_id=2,
                    ),
                    Score(
                        id=1,
                        score_uuid="current-score",
                        owner_user_id=1,
                        display_title="Current score",
                    ),
                    ExecutionManifest(id=1, sha256=manifest_sha256(MANIFEST), manifest=MANIFEST),
                ]
            )
            db.flush()
            for upload in db.scalars(select(Upload)).all():
                storage_usage_service.record_allocation(
                    db,
                    user_id=upload.uploader_user_id,
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=upload.stored_object.byte_size,
                    reason="fixture",
                )
            db.commit()
            yield db
    finally:
        engine.dispose()


def complete_jobs(db, count=1):
    jobs = [
        ImportJob(
            job_uuid=f"complete-{index}",
            user_id=1,
            state=ImportJobState.FAILED,
            progress=70,
            score_id=None,
            execution_manifest_id=1,
            requested_options=encode_requested_options(
                {
                    "display_title": "Submitted title",
                    "genres": ["jazz", "classical", "jazz"],
                }
            ),
            created_at=NOW,
            updated_at=NOW,
            processing_started_at=NOW,
            processing_finished_at=NOW,
            failure_code="import_pipeline_rejected",
            failure_stage="pipeline",
            failure_classification="user_error",
            failure_retryable=False,
            failure_detail="internal pipeline detail",
        )
        for index in range(count)
    ]
    db.add_all(jobs)
    db.flush()
    for job in jobs:
        db.add_all(
            [
                StoredObject(
                    id=101 + job.id * 2,
                    object_key=f"{job.job_uuid}/xml",
                    byte_size=29,
                    content_type="application/xml",
                    sha256="c" * 64,
                ),
            ]
        )
    db.flush()
    for job in jobs:
        db.add_all(
            [
                ImportDispatch(
                    job_id=job.id,
                    status=ImportDispatchStatus.COMPLETED,
                    attempt_count=1,
                    completed_at=NOW,
                ),
                ImportArtifact(
                    job_id=job.id,
                    kind=ImportArtifactKind.REVIEW_MUSICXML,
                    stored_object_id=101 + job.id * 2,
                    filename="score.xml",
                ),
                # Equal sort_order exercises the persistent link-id tie-breaker.
                ImportJobUpload(job_id=job.id, upload_id=2, sort_order=7, page_number=2),
                ImportJobUpload(job_id=job.id, upload_id=1, sort_order=7, page_number=1),
            ]
        )
    db.commit()
    return jobs


def test_list_and_detail_share_the_complete_current_projection(application_db):
    db = application_db
    complete_jobs(db)
    service = ImportJobService()
    detail = service.detail(db, "complete-0", 1)
    rows, total = service.list_jobs(db, 1, page=1, page_size=20)
    assert total == 1
    assert detail == rows[0]
    value = detail.model_dump(mode="json")
    assert value["job_id"] == "complete-0" and value["score_id"] is None
    assert value["display_title"] == "Submitted title" and value["genres"] == ["classical", "jazz"]
    assert value["state"] == "FAILED" and value["progress"] == 70
    assert value["execution_manifest_sha256"] == manifest_sha256(MANIFEST)
    assert value["public_code"] == CustomerErrorCode.SCORE_RECOGNITION_FAILED
    for name in ["created_at", "updated_at", "processing_started_at", "processing_finished_at"]:
        instant = datetime.fromisoformat(value[name])
        assert instant == NOW and instant.utcoffset().total_seconds() == 0
    assert value["original_images"] == [
        dict(
            artifact_id=f"upload:{number}",
            filename=f"page-{letter}.png",
            page_number=number,
            size=17,
            mime_type="image/png",
            upload_id=f"upload-{letter}",
            original_filename=f"page-{letter}.png",
        )
        for number, letter in [(2, "b"), (1, "a")]
    ]
    assert "internal pipeline detail" not in str(value)
    assert "execution_manifest" not in value


def test_list_projection_query_count_is_bounded_for_one_and_fifty_jobs(application_db):
    db = application_db
    complete_jobs(db, 50)
    calls = []

    def count_query(*args):
        calls.append(1)

    event.listen(db.bind.engine, "before_cursor_execute", count_query)
    try:
        service = ImportJobService()
        one, total = service.list_jobs(db, 1, page=1, page_size=1)
        first_count = len(calls)
        calls.clear()
        fifty, total = service.list_jobs(db, 1, page=1, page_size=50)
        assert len(one) == 1 and len(fifty) == total == 50
        assert len(calls) == first_count
        assert len(calls) <= 6
        assert all(len(row.original_images) == 2 for row in fifty)
    finally:
        event.remove(db.bind.engine, "before_cursor_execute", count_query)


def test_read_model_requires_valid_durable_requested_options(application_db):
    db = application_db
    job = (complete_jobs(db))[0]
    job.requested_options = {"schema_version": 1, "display_title": None, "genres": ["unsupported"]}
    db.commit()
    with pytest.raises(ValidationError):
        ImportJobService().detail(db, job.job_uuid, 1)


@pytest.mark.parametrize("failure", ["missing", "foreign", "links"])
def test_submission_rolls_back_the_whole_admission_unit(application_db, failure):
    db = application_db
    user = db.get(User, 1)
    upload_ids = {
        "missing": ["upload-a", "absent"],
        "foreign": ["upload-other"],
        "links": ["upload-a", "upload-a"],
    }[failure]
    request = ImportJobSubmitRequest(upload_ids=upload_ids)
    error = IntegrityError if failure == "links" else ResourceNotFoundException
    with pytest.raises(error) as caught:
        ImportJobSubmissionService().submit(db, user, request)
    if failure != "links":
        assert caught.value.code == CustomerErrorCode.FILE_NOT_FOUND
    with Session(db.bind) as observer:
        for model in [ImportJob, ImportDispatch, ImportJobUpload]:
            assert observer.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.asyncio
async def test_concurrent_idempotency_admits_one_job_dispatch_and_ordered_link_set(application_db):
    db = application_db
    both_looked_up = Barrier(2)
    service = ImportJobSubmissionService()
    request = ImportJobSubmitRequest(
        upload_ids=["upload-b", "upload-a"], idempotency_key="parallel-admission"
    )

    def submit():
        with Session(db.bind, expire_on_commit=False) as contender:
            user = contender.get(User, 1)
            both_looked_up.wait(10)
            result = service.submit(contender, user, request)
            contender.commit()
            return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(submit), pool.submit(submit)
        first, second = a.result(20), b.result(20)
    assert first == second
    assert db.scalar(select(func.count()).select_from(ImportJob)) == 1
    assert db.scalar(select(func.count()).select_from(ImportDispatch)) == 1
    links = list(
        (db.execute(select(ImportJobUpload).order_by(ImportJobUpload.sort_order))).scalars()
    )
    assert [(link.upload_id, link.page_number, link.sort_order) for link in links] == [
        (2, 1, 1),
        (1, 2, 2),
    ]


@pytest.mark.asyncio
async def test_http_list_detail_submit_retry_use_only_injected_session(application_db):
    db = application_db
    complete_jobs(db)

    def database():
        yield db

    def user():
        return db.get(User, 1)

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/import-jobs")
            assert response.status_code == 200, response.text
            detail = await client.get("/api/v1/import-jobs/complete-0")
            assert detail.status_code == 200, detail.text
            assert response.json()["items"][0] == detail.json()
            request = dict(
                upload_ids=["upload-b", "upload-a"],
                idempotency_key="http-admission",
                options={"display_title": "New", "genres": ["jazz"]},
            )
            created = await client.post("/api/v1/import-jobs", json=request)
            assert created.status_code == 202, created.text
            replay = await client.post("/api/v1/import-jobs", json=request)
            assert replay.json()["job_id"] == created.json()["job_id"]
            retry = await client.post("/api/v1/import-jobs/complete-0/retry")
            assert retry.status_code == 202, retry.text
            assert retry.json()["job_id"] != "complete-0"
            retried = await client.get("/api/v1/import-jobs/" + retry.json()["job_id"])
            value = retried.json()
            assert value["display_title"] == "Submitted title" and value["genres"] == [
                "classical",
                "jazz",
            ]
            assert [image["upload_id"] for image in value["original_images"]] == [
                "upload-b",
                "upload-a",
            ]
            assert value["state"] == "QUEUED"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_owned_job_authorization_precedes_projection_and_mutation(application_db):
    db = application_db
    other = ImportJob(
        requested_options=encode_requested_options(None),
        processing_finished_at=utc_now(),
        job_uuid="other-job",
        user_id=2,
        state=ImportJobState.FAILED,
        failure_code="import_pipeline_failed",
        failure_stage="pipeline",
        failure_classification="system_error",
        failure_retryable=False,
    )
    db.add(other)
    db.flush()
    db.add(ImportDispatch(job_id=other.id, status=ImportDispatchStatus.COMPLETED, completed_at=NOW))
    db.commit()

    def database():
        yield db

    def user():
        return db.get(User, 1)

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            for method, path in [
                ("GET", ""),
                ("POST", "/retry"),
                ("DELETE", ""),
                ("GET", "/artifacts/unknown/download"),
            ]:
                response = await client.request(method, "/api/v1/import-jobs/other-job" + path)
                assert response.status_code == 403, response.text
            assert (await client.get("/api/v1/import-jobs/missing-job")).status_code == 404
            assert (await client.get("/api/v1/import-jobs")).json()["items"] == []
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_review_confirmation_wins_over_stale_customer_delete_and_retains_provenance(
    application_db,
):
    from app.core.exceptions import ValidationException
    from app.db.models import ScoreRevision, ScoreInputAsset
    from app.modules.import_jobs.deletion_service import ImportJobDeletionService
    from app.modules.import_jobs.review.service import ImportReviewService
    from app.modules.import_jobs.review.schemas import ReviewConfirmRequest
    from tests.support.object_storage import InMemoryObjectStorage
    from tests.test_score_revision_services import MUSICXML_1

    db = application_db
    # This fixture assigns explicit IDs; confirmation creates new rows from sequences.
    db.execute(
        text("SELECT setval(pg_get_serial_sequence('scores', 'id'), (SELECT max(id) FROM scores))")
    )
    db.execute(
        text(
            "SELECT setval(pg_get_serial_sequence('stored_objects', 'id'), "
            "(SELECT max(id) FROM stored_objects))"
        )
    )
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
        job_uuid="review-delete-race",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW,
    )
    db.add(job)
    db.flush()
    db.add(ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED))
    # Confirmation promotes the input and cleans the temporary artifact and upload link.
    db.add(ImportJobUpload(job_id=job.id, upload_id=1, page_number=1, sort_order=1))
    db.add(
        ImportArtifact(
            job_id=job.id,
            kind=ImportArtifactKind.REVIEW_MUSICXML,
            filename="review.musicxml",
            stored_object_id=2,
            page_number=1,
        )
    )
    storage_usage_service.record_allocation(
        db,
        user_id=1,
        category=StorageUsageCategory.TEMP_IMPORT,
        bytes_count=db.get(StoredObject, 2).byte_size,
        reason="fixture",
    )
    db.commit()
    job_id = job.id
    observed, confirm_committed = Event(), Event()

    class WaitingDeletion(ImportJobDeletionService):
        def delete_job(self, session, caller, user_id):
            assert caller.state == ImportJobState.READY_FOR_REVIEW
            observed.set()
            assert confirm_committed.wait(20)
            return super().delete_job(session, caller, user_id)

    storage = InMemoryObjectStorage()
    storage.put_bytes(
        key="jobs/review.musicxml", content=b"<score-partwise/>", content_type="application/xml"
    )
    with (
        Session(db.bind, expire_on_commit=False) as deleting,
        Session(db.bind, expire_on_commit=False) as confirming,
    ):
        job_uuid = job.job_uuid

        def delete():
            with Session(db.bind, expire_on_commit=False) as request_db:
                return ImportJobService(deletion_service=WaitingDeletion()).delete(
                    request_db, job_uuid, 1
                )

        request = asyncio.create_task(asyncio.to_thread(delete))
        assert await asyncio.to_thread(observed.wait, 10)
        try:
            review = ImportReviewService(storage=storage)
            confirmed = review.confirm(
                confirming, job.job_uuid, 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
            )
        finally:
            confirm_committed.set()
        with pytest.raises(ValidationException) as error:
            await asyncio.wait_for(request, 20)
        assert error.value.code == CustomerErrorCode.VALIDATION_ERROR
        assert error.value.details == {"field": "state"}
        deleting.rollback()
        # Idempotent confirmation returns the same fully committed Score.
        replay = review.confirm(
            confirming, job.job_uuid, 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
        )
        assert replay.score_id == confirmed.score_id
    with Session(db.bind) as check:
        persisted = check.get(ImportJob, job_id)
        score = (
            check.execute(select(Score).where(Score.score_uuid == confirmed.score_id))
        ).scalar_one()
        assert (
            persisted.state == ImportJobState.CONFIRMED
            and score.created_from_import_job_id == persisted.id
        )
        assert score.created_from_import_job_id == job_id
        revision = (
            check.execute(select(ScoreRevision).where(ScoreRevision.score_id == score.id))
        ).scalar_one()
        assert revision.created_by_user_id == 1 and revision.revision_number == 1
        assert (
            check.scalar(
                select(func.count())
                .select_from(ImportDispatch)
                .where(ImportDispatch.job_id == job_id)
            )
            == 1
        )
        assert (
            check.scalar(
                select(func.count())
                .select_from(ImportArtifact)
                .where(ImportArtifact.job_id == job_id)
            )
            == 0
        )
        assert (
            check.scalar(
                select(func.count())
                .select_from(ImportJobUpload)
                .where(ImportJobUpload.job_id == job_id)
            )
            == 0
        )
        assert (
            check.scalar(
                select(func.count())
                .select_from(ScoreInputAsset)
                .where(ScoreInputAsset.score_id == score.id)
            )
            == 1
        )


@pytest.mark.parametrize(
    "options,expected",
    [
        (None, {"schema_version": 1, "display_title": None, "genres": []}),
        (
            {"display_title": "Etudes", "genres": ["jazz", "classical", "jazz"]},
            {"schema_version": 1, "display_title": "Etudes", "genres": ["classical", "jazz"]},
        ),
    ],
)
def test_submission_persists_canonical_v1_requested_intent(application_db, options, expected):
    db = application_db
    request = ImportJobSubmitRequest(upload_ids=["upload-a"], options=options)
    result = ImportJobSubmissionService().submit(db, db.get(User, 1), request)
    db.expire_all()
    job = db.scalar(select(ImportJob).where(ImportJob.job_uuid == result["job_id"]))
    assert job.requested_options == expected
    assert "schema_version" not in (request.model_dump()["options"] or {})


def test_retry_decodes_intent_and_encodes_a_new_durable_payload(application_db, monkeypatch):
    from unittest.mock import Mock
    from app.modules.import_jobs import submission_service

    db = application_db
    complete_jobs(db)
    original = db.scalar(select(ImportJob).where(ImportJob.job_uuid == "complete-0"))
    original_payload = original.requested_options
    encoder = Mock(wraps=encode_requested_options)
    monkeypatch.setattr(submission_service, "encode_requested_options", encoder)
    result = ImportJobService().retry(db, original.job_uuid, db.get(User, 1), 1)
    encoder.assert_called_once()
    intent = encoder.call_args.args[0]
    assert set(intent) == {"display_title", "genres"}
    assert "schema_version" not in intent
    retried = db.scalar(select(ImportJob).where(ImportJob.job_uuid == result["job_id"]))
    assert retried.job_uuid != original.job_uuid
    assert retried.requested_options == original_payload
    assert retried.requested_options is not original_payload
