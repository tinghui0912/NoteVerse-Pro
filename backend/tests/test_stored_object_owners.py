from tests.support.import_execution import processing_lease
import hashlib
import io
from unittest.mock import Mock

from fastapi import UploadFile
from sqlalchemy import select
import pytest
from PIL import Image

from app.db.models import StoredObject, Upload, ScoreRevisionSource
from app.db.models.score import RevisionSourceFormat
from app.modules.account.avatar_service import AvatarService
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.modules.account.profile_service import ProfileService
from app.modules.auth.schemas import User as UserRead
from app.modules.files.service import FilesService
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_objects.writes import write_object
from tests.support.retirement import drain_retirements
from app.db.models import StoredObjectRetirement
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_score_revision_services import (
    AsyncSessionAdapter,
    add_active_score_with_head_revision,
    MUSICXML_1,
)


@pytest.mark.asyncio
async def test_upload_dedup_is_owned_by_upload_references(score_service_session):
    db, storage = score_service_session
    from app.db.models import User

    score = add_active_score_with_head_revision(
        db,
        score_id=901,
        revision_id=902,
        score_uuid="same-bytes-score",
        revision_uuid="same-bytes-revision",
        title="Same bytes",
    )
    key = "scores/same-bytes/source.musicxml"
    mime = "application/vnd.recordare.musicxml+xml"
    storage.put_bytes(key=key, content=MUSICXML_1, content_type=mime)
    unrelated = object_from_bytes(object_key=key, content=MUSICXML_1, content_type=mime)
    db.add(
        ScoreRevisionSource(
            source_uuid="same-bytes-source",
            revision_id=score.head_revision_id,
            format=RevisionSourceFormat.MUSICXML,
            stored_object=unrelated,
            filename="score.musicxml",
            generator="test",
            generator_version="1",
        )
    )
    db.commit()
    user = db.get(User, 1)
    service = FilesService(storage=storage)
    put = Mock(wraps=storage.put_bytes)
    storage.put_bytes = put
    first = await service.upload_file(
        AsyncSessionAdapter(db), user, UploadFile(filename="first.png", file=io.BytesIO(MUSICXML_1))
    )
    second = await service.upload_file(
        AsyncSessionAdapter(db),
        user,
        UploadFile(filename="second.png", file=io.BytesIO(MUSICXML_1)),
    )
    uploads = list(db.scalars(select(Upload).order_by(Upload.id)))
    assert [upload.original_filename for upload in uploads] == ["first.png", "second.png"]
    assert uploads[0].stored_object_id == uploads[1].stored_object_id != unrelated.id
    assert put.call_count == 1
    assert (
        len(db.scalars(select(StoredObject).where(StoredObject.sha256 == unrelated.sha256)).all())
        == 2
    )
    physical_key = uploads[0].stored_object.object_key
    await service.delete_uploaded_file(AsyncSessionAdapter(db), user, first.file_id)
    assert storage.exists(physical_key)
    await service.delete_uploaded_file(AsyncSessionAdapter(db), user, second.file_id)
    assert storage.exists(physical_key)
    assert db.scalar(select(StoredObjectRetirement)).status == "PENDING"
    assert drain_retirements(db, storage)[0]["status"] == "completed"
    assert not storage.exists(physical_key)
    assert storage.read_bytes(key) == MUSICXML_1
    assert db.get(StoredObject, unrelated.id) is not None


@pytest.mark.asyncio
async def test_avatar_reference_and_profile_use_immutable_processed_bytes(score_service_session):
    db, storage = score_service_session
    from app.db.models import User

    user = db.get(User, 1)
    service = AvatarService(storage=storage)
    put = Mock(wraps=storage.put_bytes)
    storage.put_bytes = put

    def image(color):
        output = io.BytesIO()
        Image.new("RGB", (20, 20), color).save(output, format="PNG")
        return output.getvalue()

    first_name, first_url = await service.replace_user_avatar(
        AsyncSessionAdapter(db), user, file_bytes=image("red"), filename="same.png"
    )
    first_id = user.avatar_object_id
    first_key = user.avatar_object.object_key
    first_bytes = storage.read_bytes(first_key)
    assert user.avatar_object.sha256 == hashlib.sha256(first_bytes).hexdigest()
    second_name, second_url = await service.replace_user_avatar(
        AsyncSessionAdapter(db), user, file_bytes=image("blue"), filename="same.png"
    )
    assert first_name != second_name and first_url != second_url
    assert user.avatar_object_id != first_id
    assert first_key != user.avatar_object.object_key
    assert storage.read_bytes(user.avatar_object.object_key) != first_bytes
    assert put.call_args_list[0].kwargs["key"] != put.call_args_list[1].kwargs["key"]
    assert storage.exists(first_key)
    assert db.get(StoredObject, first_id) is not None
    assert drain_retirements(db, storage)[0]["status"] == "completed"
    assert not storage.exists(first_key)
    assert db.get(StoredObject, first_id) is None
    assert (
        avatar_url_for_user(user)
        == ProfileService().profile_payload(user).user.avatar_url
        == second_url
    )
    assert UserRead.model_validate(user).avatar_url == second_url
    from app.modules.account.router import read_avatar

    signed = Mock(side_effect=["https://delivery.example/one", "https://delivery.example/two"])
    storage.download_url = signed
    first_redirect = await read_avatar(second_name, AsyncSessionAdapter(db), service)
    second_redirect = await read_avatar(second_name, AsyncSessionAdapter(db), service)
    assert first_redirect.headers["location"] != second_redirect.headers["location"]
    assert signed.call_count == 2
    signed.assert_called_with(user.avatar_object.object_key, content_type="image/jpeg")
    assert avatar_url_for_user(user) == second_url
    current_id, current_key = user.avatar_object_id, user.avatar_object.object_key
    assert await service.clear_user_avatar(AsyncSessionAdapter(db), user)
    assert user.avatar_object_id is None and user.avatar_object is None
    assert avatar_url_for_user(user) is None
    assert db.get(StoredObject, current_id) is not None
    assert drain_retirements(db, storage)[0]["status"] == "completed"
    assert db.get(StoredObject, current_id) is None
    assert not storage.exists(current_key)


@pytest.mark.asyncio
@pytest.mark.parametrize("cleanup_fails", [False, True])
async def test_import_artifact_replacement_uses_complete_immutable_object_facts(
    score_service_session, monkeypatch, cleanup_fails
):
    from app.db.models import ImportJob, ImportArtifact
    from app.db.models.import_job import ImportJobState
    from app.modules.import_jobs.worker_service import SyncImportJobService
    from app.modules.import_jobs.service import ImportJobService

    db, storage = score_service_session
    job = ImportJob(job_uuid="physical-import", user_id=1, state=ImportJobState.PENDING_REVIEW)
    db.add(job)
    db.commit()
    worker = SyncImportJobService()

    def item(key, content):
        written = write_object(
            db, storage, key=key, content=content, content_type="application/xml"
        )
        return dict(
            write_intent_uuid=written.intent_uuid,
            write_token=written.write_token,
            filename="score.xml",
            page_number=None,
        )

    worker.replace_artifacts(
        db, processing_lease(db, job), "review_musicxml", [item("jobs/first", b"first")]
    )
    first = db.scalar(select(ImportArtifact))
    first_object, first_key = first.stored_object, first.stored_object.object_key
    from app.modules.storage_objects.persistence import object_from_row

    first_facts = object_from_row(first_object)
    if cleanup_fails:
        monkeypatch.setattr(
            storage, "delete", Mock(side_effect=OSError("object store unavailable"))
        )
    worker.replace_artifacts(
        db, processing_lease(db, job), "review_musicxml", [item("jobs/second", b"second")]
    )
    current = db.scalar(select(ImportArtifact))
    assert current.stored_object is not first_object
    assert object_from_row(first_object) == first_facts
    assert db.scalar(select(StoredObject).where(StoredObject.object_key == first_key)) is not None
    assert storage.exists(first_key)
    outcome = drain_retirements(db, storage)[0]
    assert outcome["status"] == ("failed" if cleanup_fails else "completed")
    assert (
        db.scalar(select(StoredObject).where(StoredObject.object_key == first_key)) is not None
    ) is cleanup_fails
    assert current.stored_object.byte_size == len(b"second")
    assert current.stored_object.sha256 == hashlib.sha256(b"second").hexdigest()
    assert storage.exists(first_key) is cleanup_fails
    delivery = await ImportJobService(storage=storage).artifact_delivery(
        AsyncSessionAdapter(db), job.job_uuid, current.artifact_uuid, 1
    )
    assert delivery.filename == "score.xml" and delivery.media_type == "application/xml"
    assert storage.read_bytes(delivery.storage_key) == b"second"


@pytest.mark.asyncio
async def test_avatar_retirement_failure_cannot_revert_new_reference(
    score_service_session, monkeypatch
):
    db, storage = score_service_session
    from app.db.models import User

    user = db.get(User, 1)
    service = AvatarService(storage=storage)

    def picture(color):
        output = io.BytesIO()
        Image.new("RGB", (2, 2), color).save(output, format="PNG")
        return output.getvalue()

    await service.replace_user_avatar(
        AsyncSessionAdapter(db), user, file_bytes=picture("red"), filename="same.png"
    )
    before = user.avatar_object_id
    monkeypatch.setattr(
        storage, "delete", Mock(side_effect=OSError("physical deletion unavailable"))
    )
    _, current_url = await service.replace_user_avatar(
        AsyncSessionAdapter(db), user, file_bytes=picture("blue"), filename="same.png"
    )
    current = user.avatar_object_id
    assert current != before and storage.delete.call_count == 0
    assert drain_retirements(db, storage)[0]["status"] == "failed"
    db.refresh(user)
    assert user.avatar_object_id == current and avatar_url_for_user(user) == current_url
    assert db.get(StoredObject, before) is not None
    await service.clear_user_avatar(AsyncSessionAdapter(db), user)
    assert user.avatar_object_id is None
    assert (
        db.scalar(
            select(StoredObjectRetirement).where(StoredObjectRetirement.stored_object_id == current)
        ).status
        == "PENDING"
    )


@pytest.mark.asyncio
async def test_avatar_post_commit_refresh_failure_preserves_committed_bytes(
    score_service_session, monkeypatch
):
    from unittest.mock import AsyncMock
    from app.db.models import User

    db, storage = score_service_session
    user = db.get(User, 1)
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "blue").save(output, format="PNG")
    adapter = AsyncSessionAdapter(db)
    adapter.refresh = AsyncMock(side_effect=RuntimeError("refresh failed"))
    delete = Mock(wraps=storage.delete)
    monkeypatch.setattr(storage, "delete", delete)
    with pytest.raises(RuntimeError, match="refresh failed"):
        await AvatarService(storage=storage).replace_user_avatar(
            adapter, user, file_bytes=output.getvalue(), filename="new.png"
        )
    db.refresh(user)
    assert user.avatar_object_id is not None
    assert storage.exists(user.avatar_object.object_key)
    assert delete.call_count == 0


@pytest.mark.asyncio
async def test_upload_release_succeeds_while_score_source_retains_exact_object(
    score_service_session,
):
    from app.db.models import User, StorageUsageAccount

    db, storage = score_service_session
    user = db.get(User, 1)
    service = FilesService(storage=storage)
    response = await service.upload_file(
        AsyncSessionAdapter(db), user, UploadFile(filename="score.png", file=io.BytesIO(MUSICXML_1))
    )
    upload = db.scalar(select(Upload))
    identity, key = upload.stored_object_id, upload.stored_object.object_key
    score = add_active_score_with_head_revision(
        db,
        score_id=911,
        revision_id=912,
        score_uuid="shared-upload",
        revision_uuid="shared-upload-revision",
        title="Shared",
    )
    source = ScoreRevisionSource(
        source_uuid="shared-upload-source",
        revision_id=score.head_revision_id,
        format=RevisionSourceFormat.MUSICXML,
        stored_object_id=identity,
        filename="score.musicxml",
        generator="test",
        generator_version="1",
    )
    db.add(source)
    db.commit()
    await service.delete_uploaded_file(AsyncSessionAdapter(db), user, response.file_id)
    assert db.scalar(select(Upload)) is None
    assert db.get(StoredObject, identity) is not None and storage.exists(key)
    assert db.scalar(select(StoredObjectRetirement)) is None
    assert db.get(StorageUsageAccount, 1).used_bytes == 0
    assert source.stored_object_id == identity


@pytest.mark.parametrize("kind", ["render", "playback"])
def test_derived_replacement_commits_new_asset_and_old_retirement_atomically(
    score_service_session, monkeypatch, kind
):
    from uuid import uuid4
    from app.db.models import (
        ScoreRevision,
        ScoreRenderAsset,
        ScorePlaybackAsset,
        StorageUsageCounter,
        StorageUsageCategory,
        StorageUsageEvent,
    )
    from app.modules.score_assets.render_service import RevisionRenderService
    from app.modules.playback.service import PlaybackGenerationService
    from app.processing.engines.playback import RenderedAudio

    db, storage = score_service_session
    score = add_active_score_with_head_revision(
        db,
        score_id=921,
        revision_id=922,
        score_uuid="replace",
        revision_uuid="replace-revision",
        title="Replace",
    )
    revision = db.get(ScoreRevision, 922)
    revision.content_hash = hashlib.sha256(MUSICXML_1).hexdigest()
    storage.put_bytes(
        key="scores/replace/source", content=MUSICXML_1, content_type="application/xml"
    )
    db.add(
        ScoreRevisionSource(
            source_uuid="replace-source",
            revision_id=922,
            format=RevisionSourceFormat.MUSICXML,
            filename="score.xml",
            generator="test",
            generator_version="1",
            stored_object=object_from_bytes(
                object_key="scores/replace/source",
                content=MUSICXML_1,
                content_type="application/xml",
            ),
        )
    )
    db.commit()
    if kind == "render":
        service = RevisionRenderService(storage=storage)
        model, category = ScoreRenderAsset, StorageUsageCategory.DERIVED_RENDER

        def records(session, **kwargs):
            key = f"scores/replace/render/{uuid4()}.svg"
            written = write_object(
                session, storage, key=key, content=b"<svg />", content_type="image/svg+xml"
            )
            kwargs["uploaded_keys"].append(key)
            return [
                dict(
                    asset_uuid=str(uuid4()),
                    revision_id=922,
                    written=written,
                    page_number=1,
                    profile="default",
                    generator="test",
                )
            ]

        monkeypatch.setattr(service, "_render_records", records)

        def generate():
            return service.render_for_worker(
                db,
                score.score_uuid,
                revision.revision_uuid,
                source_fingerprint=revision.content_hash,
                profile="default",
            )[0]
    else:
        renderer = Mock()
        renderer.render.return_value = RenderedAudio(
            content=b"RIFFexact",
            mime_type="audio/wav",
            extension=".wav",
            duration_ms=100,
            generator="test",
            generator_version="1",
            soundfont_sha256="a" * 64,
        )
        service = PlaybackGenerationService(storage=storage, renderer=renderer)
        model, category = ScorePlaybackAsset, StorageUsageCategory.DERIVED_AUDIO

        def generate():
            return service.render_sync(
                db,
                score.score_uuid,
                revision.revision_uuid,
                source_fingerprint=revision.content_hash,
            )

    old = generate()
    old_id, key, size = (
        old.stored_object_id,
        old.stored_object.object_key,
        old.stored_object.byte_size,
    )
    current = generate()
    assert list(db.scalars(select(model))) == [current]
    assert current.stored_object_id != old_id and storage.exists(current.stored_object.object_key)
    operation = db.scalar(select(StoredObjectRetirement))
    assert operation.stored_object_id == old_id and operation.status == "PENDING"
    assert operation.object_key == key and storage.exists(key)
    counter = db.scalar(select(StorageUsageCounter).where(StorageUsageCounter.category == category))
    assert counter.used_bytes == current.stored_object.byte_size
    events = list(
        db.scalars(select(StorageUsageEvent).where(StorageUsageEvent.category == category))
    )
    assert any(event.delta_bytes == -size for event in events)
    assert drain_retirements(db, storage)[0]["status"] == "completed"
    assert not storage.exists(key) and storage.exists(current.stored_object.object_key)


def test_orphan_scan_retirement_failure_rolls_back_only_that_owner(
    score_service_session, monkeypatch
):
    from datetime import timedelta
    from app.db.models import StorageUsageAccount, StorageUsageCategory
    from app.modules.import_jobs.maintenance_service import ImportJobMaintenanceService
    from app.modules.storage_usage.service import storage_usage_service
    from app.utils.timezone import utc_now_naive

    db, storage = score_service_session
    uploads = []
    for i in range(2):
        key = f"blobs/orphan/{i}.png"
        storage.put_bytes(key=key, content=b"png", content_type="image/png")
        obj = object_from_bytes(object_key=key, content=b"png", content_type="image/png")
        upload = Upload(
            stored_object=obj,
            original_filename="orphan.png",
            uploader_user_id=1,
            created_at=utc_now_naive() - timedelta(days=365),
        )
        db.add(upload)
        db.commit()
        uploads.append((upload.id, obj.id))
        storage_usage_service.record_allocation_sync(
            db, user_id=1, category=StorageUsageCategory.UPLOAD, bytes_count=3, reason="test_orphan"
        )
    from app.modules.import_jobs import maintenance_service as maintenance

    retire = maintenance.retire_released_objects

    def queue(session, object_id):
        if object_id == uploads[1][1]:
            raise ValueError("retirement admission unavailable")
        return retire(session, object_id)

    monkeypatch.setattr(maintenance, "retire_released_objects", queue)
    assert ImportJobMaintenanceService().cleanup_orphan_uploads(db) == 1
    assert db.get(Upload, uploads[0][0]) is None
    assert db.get(Upload, uploads[1][0]) is not None
    assert db.get(StorageUsageAccount, 1).used_bytes == 3
    operations = list(db.scalars(select(StoredObjectRetirement)))
    assert len(operations) == 1 and operations[0].stored_object_id == uploads[0][1]
    assert all(storage.exists(f"blobs/orphan/{i}.png") for i in range(2))
