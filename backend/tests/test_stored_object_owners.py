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
    worker = SyncImportJobService(storage=storage)

    def item(key, content):
        storage.put_bytes(key=key, content=content, content_type="application/xml")
        return dict(
            storage_key=key,
            filename="score.xml",
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            mime_type="application/xml",
            page_number=None,
        )

    worker.replace_artifacts(db, job.job_uuid, "review_musicxml", [item("jobs/first", b"first")])
    first = db.scalar(select(ImportArtifact))
    first_object, first_key = first.stored_object, first.stored_object.object_key
    from app.modules.storage_objects.persistence import object_from_row

    first_facts = object_from_row(first_object)
    if cleanup_fails:
        monkeypatch.setattr(
            storage, "delete", Mock(side_effect=OSError("object store unavailable"))
        )
    worker.replace_artifacts(db, job.job_uuid, "review_musicxml", [item("jobs/second", b"second")])
    current = db.scalar(select(ImportArtifact))
    assert current.stored_object is not first_object
    assert object_from_row(first_object) == first_facts
    assert db.scalar(select(StoredObject).where(StoredObject.object_key == first_key)) is None
    assert current.stored_object.byte_size == len(b"second")
    assert current.stored_object.sha256 == hashlib.sha256(b"second").hexdigest()
    assert storage.exists(first_key) is cleanup_fails
    delivery = await ImportJobService(storage=storage).artifact_delivery(
        AsyncSessionAdapter(db), job.job_uuid, current.artifact_uuid, 1
    )
    assert delivery.filename == "score.xml" and delivery.media_type == "application/xml"
    assert storage.read_bytes(delivery.storage_key) == b"second"
