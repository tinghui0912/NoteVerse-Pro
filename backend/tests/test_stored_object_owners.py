from tests.support.runtime_resources import resources_for
from tests.support.uploads import complete_image_upload
from tests.support.uploads import settled_upload_session
from app.composition import storage_resources as _resource_wiring

from uuid import uuid4
from app.modules.import_jobs.domain import ImportArtifactKind
from app.modules.import_jobs.requested_options import encode_requested_options
from app.shared.time import utc_now
from tests.support.images import image_bytes
from tests.support.import_execution import processing_lease
from tests.support.derivative_execution import revision_attempt
import hashlib
import io
from unittest.mock import Mock

from fastapi import UploadFile
from sqlalchemy import select
import pytest
from PIL import Image

from app.db.models import StoredObject, Upload, ScoreRevisionSource
from app.modules.revisions.domain import RevisionSourceFormat
from app.modules.account.avatar_service import AvatarService
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.modules.account.profile_service import ProfileService
from app.modules.auth.schemas import User as UserRead
from app.modules.uploads.service import UploadService
from app.modules.media_storage.persistence import object_from_bytes

from tests.support.retirement import drain_retirements
from app.db.models import StoredObjectRetirement
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.test_score_revision_services import (
    add_active_score_with_head_revision,
    MUSICXML_1,
)
from app.platform.config.import_dispatch import ImportDispatchSettings
from app.platform.config.storage import MediaStoragePolicyConfig
from app.runtime.customer_api.context import get_context
from tests.support.runtime_resources import deliveries


def test_upload_commands_preserve_independent_objects_and_other_domains(score_service_session):
    db, storage = score_service_session
    from app.db.models import User, ScoreRenderAsset
    from app.modules.score_assets.domain import RenderAssetKind

    score = add_active_score_with_head_revision(
        db,
        score_id=901,
        revision_id=902,
        score_uuid="same-bytes-score",
        revision_uuid="same-bytes-revision",
        title="Same bytes",
    )
    key = "scores/same-bytes/page.png"
    mime = "image/png"
    storage.put_bytes(key=key, content=image_bytes(), content_type=mime)
    unrelated = object_from_bytes(object_key=key, content=image_bytes(), content_type=mime)
    db.add(
        ScoreRenderAsset(
            asset_uuid="same-bytes-render",
            revision_id=score.head_revision_id,
            kind=RenderAssetKind.RENDERED_PAGE,
            render_profile="default",
            page_number=1,
            stored_object=unrelated,
            filename="page.png",
            generator="test",
            generator_version="1",
        )
    )
    db.commit()
    unrelated_id, unrelated_digest = unrelated.id, unrelated.sha256
    user = db.get(User, 1)
    service = UploadService(
        quota=_resource_wiring.storage_quota_service,
        usage=_resource_wiring.storage_usage_service,
        uploads=resources_for(storage).build_upload_session_service(),
    )
    put = Mock(wraps=storage.put_bytes)
    storage.put_bytes = put
    first = complete_image_upload(
        service,
        db,
        user,
        UploadFile(filename="first.png", file=io.BytesIO(image_bytes())),
        client_request_id=uuid4().hex,
    )
    second = complete_image_upload(
        service,
        db,
        user,
        UploadFile(filename="second.png", file=io.BytesIO(image_bytes())),
        client_request_id=uuid4().hex,
    )
    uploads = list(db.scalars(select(Upload).order_by(Upload.id)))
    assert [upload.original_filename for upload in uploads] == ["first.png", "second.png"]
    assert len({uploads[0].stored_object_id, uploads[1].stored_object_id, unrelated_id}) == 3
    assert put.call_count == 4
    assert (
        len(db.scalars(select(StoredObject).where(StoredObject.sha256 == unrelated_digest)).all())
        == 3
    )
    physical_key = uploads[0].stored_object.object_key
    service.delete_upload(db, db.get(User, 1), first.upload_id)
    db.commit()
    assert storage.exists(physical_key)
    service.delete_upload(db, db.get(User, 1), second.upload_id)
    db.commit()
    assert storage.exists(physical_key)
    assert all(row.status == "PENDING" for row in db.scalars(select(StoredObjectRetirement)))
    assert all(result["status"] == "completed" for result in drain_retirements(db, storage))
    assert not storage.exists(physical_key)
    assert storage.read_bytes(key) == image_bytes()
    assert db.get(StoredObject, unrelated_id) is not None


def test_avatar_reference_and_profile_use_immutable_processed_bytes(score_service_session):
    db, storage = score_service_session
    from app.db.models import User

    user = db.get(User, 1)
    service = AvatarService(
        writes=resources_for(storage).build_object_write_coordinator(),
        delivery=resources_for(storage).build_media_delivery_service(),
        config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
    )
    put = Mock(wraps=storage.put_bytes)
    storage.put_bytes = put

    def image(color):
        output = io.BytesIO()
        Image.new("RGB", (20, 20), color).save(output, format="PNG")
        return output.getvalue()

    first_name, first_url = service.replace_user_avatar(
        db, user, file_bytes=image("red"), filename="same.png"
    )
    first_id = user.avatar_object_id
    first_key = user.avatar_object.object_key
    first_bytes = storage.read_bytes(first_key)
    assert user.avatar_object.sha256 == hashlib.sha256(first_bytes).hexdigest()
    second_name, second_url = service.replace_user_avatar(
        db, user, file_bytes=image("blue"), filename="same.png"
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
    from app.runtime.customer_api.routers.account.router import read_avatar

    signed = Mock(side_effect=["https://delivery.example/one", "https://delivery.example/two"])
    storage.download_url = signed
    first_redirect = read_avatar(second_name, db, service)
    second_redirect = read_avatar(second_name, db, service)
    assert first_redirect.headers["location"] != second_redirect.headers["location"]
    assert signed.call_count == 2
    signed.assert_called_with(
        user.avatar_object.object_key,
        filename=None,
        content_type="image/jpeg",
        expires_seconds=900,
    )
    assert avatar_url_for_user(user) == second_url
    current_id, current_key = user.avatar_object_id, user.avatar_object.object_key
    assert service.clear_user_avatar(db, user)
    assert user.avatar_object_id is None and user.avatar_object is None
    assert avatar_url_for_user(user) is None
    assert db.get(StoredObject, current_id) is not None
    assert drain_retirements(db, storage)[0]["status"] == "completed"
    assert db.get(StoredObject, current_id) is None
    assert not storage.exists(current_key)


@pytest.mark.parametrize("cleanup_fails", [False, True])
def test_import_artifact_replacement_uses_complete_immutable_object_facts(
    score_service_session, monkeypatch, cleanup_fails
):
    from app.db.models import ImportJob, ImportArtifact
    from app.modules.import_jobs.domain import ImportJobState
    from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
    from app.modules.import_jobs.service import ImportJobService

    db, storage = score_service_session
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
        job_uuid="physical-import",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW,
    )
    db.add(job)
    db.commit()
    worker = ImportExecutionRecorder(usage=_resource_wiring.storage_usage_service)

    def item(key, content):
        written = (
            resources_for(storage)
            .build_object_write_coordinator()
            .write_bytes(key=key, content=content, content_type="application/xml")
        )
        return dict(
            write_intent_uuid=written.intent_uuid,
            write_token=written.write_token,
            filename="score.xml",
            page_number=None,
        )

    worker.replace_artifacts(
        db,
        processing_lease(db, job),
        ImportArtifactKind.REVIEW_MUSICXML,
        [item("jobs/first", b"first")],
    )
    first = db.scalar(select(ImportArtifact))
    first_object, first_key = first.stored_object, first.stored_object.object_key
    from app.modules.media_storage.persistence import object_from_row

    first_facts = object_from_row(first_object)
    if cleanup_fails:
        monkeypatch.setattr(
            storage, "delete", Mock(side_effect=OSError("object store unavailable"))
        )
    worker.replace_artifacts(
        db,
        processing_lease(db, job),
        ImportArtifactKind.REVIEW_MUSICXML,
        [item("jobs/second", b"second")],
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
    delivery = ImportJobService(
        usage=_resource_wiring.storage_usage_service,
        delivery=resources_for(storage).build_media_delivery_service(),
    ).artifact_delivery(db, job.job_uuid, current.artifact_uuid, 1)
    assert delivery.filename == "score.xml" and delivery.media_type == "application/xml"
    assert storage.read_bytes(delivery.storage_key) == b"second"


def test_avatar_retirement_failure_cannot_revert_new_reference(score_service_session, monkeypatch):
    db, storage = score_service_session
    from app.db.models import User

    user = db.get(User, 1)
    service = AvatarService(
        writes=resources_for(storage).build_object_write_coordinator(),
        delivery=resources_for(storage).build_media_delivery_service(),
        config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
    )

    def picture(color):
        output = io.BytesIO()
        Image.new("RGB", (2, 2), color).save(output, format="PNG")
        return output.getvalue()

    service.replace_user_avatar(db, user, file_bytes=picture("red"), filename="same.png")
    before = user.avatar_object_id
    monkeypatch.setattr(
        storage, "delete", Mock(side_effect=OSError("physical deletion unavailable"))
    )
    _, current_url = service.replace_user_avatar(
        db, user, file_bytes=picture("blue"), filename="same.png"
    )
    current = user.avatar_object_id
    assert current != before and storage.delete.call_count == 0
    assert drain_retirements(db, storage)[0]["status"] == "failed"
    db.refresh(user)
    assert user.avatar_object_id == current and avatar_url_for_user(user) == current_url
    assert db.get(StoredObject, before) is not None
    service.clear_user_avatar(db, user)
    assert user.avatar_object_id is None
    assert (
        db.scalar(
            select(StoredObjectRetirement).where(StoredObjectRetirement.stored_object_id == current)
        ).status
        == "PENDING"
    )


def test_avatar_post_commit_refresh_failure_preserves_committed_bytes(
    score_service_session, monkeypatch
):
    from unittest.mock import Mock
    from app.db.models import User

    db, storage = score_service_session
    user = db.get(User, 1)
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "blue").save(output, format="PNG")
    adapter = db
    original_refresh = db.refresh
    monkeypatch.setattr(db, "refresh", Mock(side_effect=RuntimeError("refresh failed")))
    delete = Mock(wraps=storage.delete)
    monkeypatch.setattr(storage, "delete", delete)
    with pytest.raises(RuntimeError, match="refresh failed"):
        AvatarService(
            writes=resources_for(storage).build_object_write_coordinator(),
            delivery=resources_for(storage).build_media_delivery_service(),
            config=MediaStoragePolicyConfig.model_validate(get_context().settings.model_dump()),
        ).replace_user_avatar(adapter, user, file_bytes=output.getvalue(), filename="new.png")
    monkeypatch.setattr(db, "refresh", original_refresh)
    db.refresh(user)
    assert user.avatar_object_id is not None
    assert storage.exists(user.avatar_object.object_key)
    assert delete.call_count == 0


def test_upload_release_succeeds_while_score_source_retains_exact_object(
    score_service_session,
):
    from app.db.models import User, StorageUsageAccount

    db, storage = score_service_session
    user = db.get(User, 1)
    service = UploadService(
        quota=_resource_wiring.storage_quota_service,
        usage=_resource_wiring.storage_usage_service,
        uploads=resources_for(storage).build_upload_session_service(),
    )
    response = complete_image_upload(
        service,
        db,
        user,
        UploadFile(filename="score.png", file=io.BytesIO(image_bytes())),
        client_request_id=uuid4().hex,
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
    service.delete_upload(db, db.get(User, 1), response.upload_id)
    db.commit()
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
        StorageUsageEvent,
    )
    from app.modules.storage_governance.usage.domain import StorageUsageCategory
    from app.modules.score_assets.score_revision_rendering import ScoreRevisionRenderService
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
        service = ScoreRevisionRenderService(
            usage=_resource_wiring.storage_usage_service,
            writes=resources_for(storage).build_object_write_coordinator(),
            delivery=deliveries().render,
            work_root=get_context().settings.WORK_ROOT,
        )
        model, category = ScoreRenderAsset, StorageUsageCategory.DERIVED_RENDER

        def records(**kwargs):
            key = f"scores/replace/render/{uuid4()}.svg"
            written = (
                resources_for(storage)
                .build_object_write_coordinator()
                .write_bytes(key=key, content=b"<svg />", content_type="image/svg+xml")
            )
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
            payload = revision_attempt(db, kind, score, revision)
            asset = service.render_for_worker(
                db,
                score.score_uuid,
                revision.revision_uuid,
                source_fingerprint=revision.content_hash,
                profile="default",
                outbox_uuid=payload.target.outbox_uuid,
                lease=payload.lease,
            )[0]
            db.commit()
            return asset
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
        service = PlaybackGenerationService(
            renderer=renderer,
            usage=_resource_wiring.storage_usage_service,
            writes=resources_for(storage).build_object_write_coordinator(),
            delivery=deliveries().playback,
        )
        model, category = ScorePlaybackAsset, StorageUsageCategory.DERIVED_AUDIO

        def generate():
            payload = revision_attempt(db, kind, score, revision)
            asset = service.render_for_worker(
                db,
                score.score_uuid,
                revision.revision_uuid,
                source_fingerprint=revision.content_hash,
                outbox_uuid=payload.outbox_uuid,
                lease=payload.lease,
            )
            db.commit()
            return asset

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
    from app.db.models import StorageUsageAccount
    from app.modules.storage_governance.usage.domain import StorageUsageCategory
    from app.modules.import_jobs.maintenance_service import ImportJobMaintenanceService
    from app.composition.storage_resources import storage_usage_service
    from app.shared.time import utc_now

    db, storage = score_service_session
    uploads = []
    for i in range(2):
        key = f"blobs/orphan/{i}.png"
        storage.put_bytes(key=key, content=b"png", content_type="image/png")
        obj = object_from_bytes(object_key=key, content=b"png", content_type="image/png")
        upload = Upload(
            upload_session=settled_upload_session(user_id=1),
            stored_object=obj,
            original_filename="orphan.png",
            uploader_user_id=1,
            created_at=utc_now() - timedelta(days=365),
        )
        db.add(upload)
        db.commit()
        uploads.append((upload.id, obj.id))
        storage_usage_service.record_allocation(
            db, user_id=1, category=StorageUsageCategory.UPLOAD, bytes_count=3, reason="test_orphan"
        )
    db.commit()
    from app.modules.import_jobs import maintenance_service as maintenance

    retire = maintenance.retire_after_release

    def queue(session, object_id):
        if object_id == uploads[1][1]:
            raise ValueError("retirement admission unavailable")
        return retire(session, object_id)

    monkeypatch.setattr(maintenance, "retire_after_release", queue)
    assert (
        ImportJobMaintenanceService(
            usage=_resource_wiring.storage_usage_service, config=ImportDispatchSettings()
        ).cleanup_orphan_uploads(db)
        == 1
    )
    assert db.get(Upload, uploads[0][0]) is None
    assert db.get(Upload, uploads[1][0]) is not None
    assert db.get(StorageUsageAccount, 1).used_bytes == 3
    operations = list(db.scalars(select(StoredObjectRetirement)))
    assert len(operations) == 1 and operations[0].stored_object_id == uploads[0][1]
    assert all(storage.exists(f"blobs/orphan/{i}.png") for i in range(2))
