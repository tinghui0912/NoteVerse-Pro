"""Explicit upload fixtures exercise transport admission or seed already-settled history."""

from uuid import uuid4
from app.db.models.upload_session import UploadSession
from app.modules.media_storage.upload_sessions.domain import UploadPurpose, UploadMode, UploadStatus
from app.shared.time import utc_now


def settled_upload_session(*, user_id: int) -> UploadSession:
    identity = "fixture-input/" + str(uuid4())
    now = utc_now()
    return UploadSession(
        user_id=user_id,
        purpose=UploadPurpose.SCORE_IMPORT,
        mode=UploadMode.SINGLE_PUT,
        status=UploadStatus.CONSUMED,
        object_key=identity + "/staging",
        final_object_key=identity + "/final",
        expected_byte_size=1,
        expected_content_type="image/png",
        part_bytes=16 * 1024**2,
        expires_at=now,
        completed_at=now,
        consumed_at=now,
        cleanup_completed_at=now,
    )


def complete_image_upload(service, db, user, file, *, client_request_id):
    from app.modules.uploads.upload_admission import admit_score_import_image
    from app.modules.media_storage.upload_sessions.schemas import UploadCreateRequest
    from app.storage.base import DirectUploadTarget

    from sqlalchemy import inspect

    user_id = inspect(user).identity[0]
    content = file.file.read()
    media = admit_score_import_image(content, file.filename)
    admission = service.create_request(
        db,
        user_id,
        UploadCreateRequest(
            client_request_id=client_request_id,
            filename=file.filename,
            byte_size=len(content),
            content_type=media.mime_type,
        ),
    )
    if admission.upload is not None:
        return admission.upload
    transfer = admission.upload_session
    if transfer.status == UploadStatus.COMPLETED:
        return service.finalize_upload(db, user_id, transfer.session_id)
    target = transfer.upload_target
    service.uploads.storage.receive_upload(
        DirectUploadTarget(target.url, target.method, target.headers), content
    )
    service.uploads.complete(transfer.session_id, user_id)
    return service.finalize_upload(db, user_id, transfer.session_id)
