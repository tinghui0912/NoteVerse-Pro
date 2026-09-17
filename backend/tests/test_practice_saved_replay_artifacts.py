from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeReplayArtifactKind,
    PracticeReplayObjectDeletionStatus,
    PracticeSessionState,
)
from app.modules.practice.schemas import (
    PracticeReplayFinalizeRequest,
    PracticeReplayUploadAuthorizationRequest,
)
from app.modules.practice.service import PracticeService
from app.shared.constants import ErrorCode
from app.storage import DirectUploadTarget, FileStorage, StoredObjectMetadata


REPLAY_BYTES = b'{"events":[]}'
REPLAY_CHECKSUM = "24de1c4a19c43ad41b013f13dcd858c17b0daa7f33a53f19913e5b11366d1c2e"


class FakeReplayStorage:
    backend_name = "fake"

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}
        self.upload_targets: list[str] = []
        self.download_requests: list[dict[str, str | None]] = []
        self.deleted: list[str] = []

    def put_bytes(
        self,
        *,
        key: str,
        content: bytes,
        content_type: str | None = None,
    ) -> SimpleNamespace:
        self.objects[key] = content
        if content_type:
            self.content_types[key] = content_type
        return SimpleNamespace(
            storage_key=key,
            filename=key.rsplit("/", 1)[-1],
            path=f"/fake/{key}",
            size_bytes=len(content),
            public_url=None,
        )

    def upload_url(
        self,
        key: str,
        *,
        content_type: str,
        checksum_sha256: str,
    ) -> DirectUploadTarget:
        self.upload_targets.append(key)
        return DirectUploadTarget(
            upload_url=f"https://storage.example/{key}",
            upload_method="PUT",
            upload_headers={
                "content-type": content_type,
                "x-amz-meta-sha256": checksum_sha256,
            },
        )

    def exists(self, key: str) -> bool:
        return key in self.objects

    def object_metadata(self, key: str) -> StoredObjectMetadata:
        return StoredObjectMetadata(
            size_bytes=len(self.objects[key]),
            content_type=self.content_types.get(key),
        )

    def read_bytes(self, key: str) -> bytes:
        return self.objects[key]

    def delete(self, key: str) -> bool:
        self.deleted.append(key)
        return self.objects.pop(key, None) is not None

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str | None:
        self.download_requests.append(
            {
                "key": key,
                "filename": filename,
                "content_type": content_type,
            }
        )
        return f"https://storage.example/download/{key}"


def _finished_performance_session(
    *,
    input_source: PracticeInputSource = PracticeInputSource.MIDI,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=11,
        session_uuid="session-1",
        user_id=7,
        state=PracticeSessionState.FINISHED,
        evaluation_profile=PracticeEvaluationProfile.PERFORMANCE,
        input_source=input_source,
    )


def _authorization_request() -> PracticeReplayUploadAuthorizationRequest:
    return PracticeReplayUploadAuthorizationRequest(
        kind=PracticeReplayArtifactKind.MIDI_EVENTS,
        content_type="application/vnd.noteverse.replay+json",
        byte_size=len(REPLAY_BYTES),
        checksum_sha256=REPLAY_CHECKSUM,
        duration_ms=1200,
        timebase_version=1,
        format_version=1,
    )


def _audio_authorization_request(content_type: str) -> PracticeReplayUploadAuthorizationRequest:
    return PracticeReplayUploadAuthorizationRequest(
        kind=PracticeReplayArtifactKind.AUDIO_RECORDING,
        content_type=content_type,
        byte_size=len(REPLAY_BYTES),
        checksum_sha256=REPLAY_CHECKSUM,
        duration_ms=1200,
        timebase_version=1,
        format_version=1,
    )


def _finalize_request(artifact_id: str) -> PracticeReplayFinalizeRequest:
    request = _authorization_request()
    return PracticeReplayFinalizeRequest(
        artifact_id=artifact_id,
        kind=request.kind,
        content_type=request.content_type,
        byte_size=request.byte_size,
        checksum_sha256=request.checksum_sha256,
        duration_ms=request.duration_ms,
        timebase_version=request.timebase_version,
        format_version=request.format_version,
    )


def _service(
    session: SimpleNamespace,
    *,
    create_replay_artifact: AsyncMock | None = None,
    existing_replay_artifact: object | None = None,
    existing_for_kind: object | None = None,
) -> tuple[PracticeService, Mock, FakeReplayStorage]:
    repository = Mock()
    repository.get_session_by_uuid = AsyncMock(return_value=session)
    repository.create_replay_artifact = create_replay_artifact or AsyncMock(
        side_effect=lambda _db, artifact: artifact
    )
    repository.get_replay_artifact_by_uuid = AsyncMock(return_value=existing_replay_artifact)
    repository.get_replay_artifact_for_session_kind = AsyncMock(return_value=existing_for_kind)
    repository.list_replay_artifacts_for_session = AsyncMock(return_value=[])
    repository.delete_replay_artifact_and_queue_object_deletion = AsyncMock()
    storage = FakeReplayStorage()
    service = PracticeService(repository=repository, storage=cast(FileStorage, storage))
    return service, repository, storage


@pytest.mark.asyncio
async def test_authorize_replay_upload_returns_upload_target_without_creating_artifact() -> None:
    service, repository, storage = _service(_finished_performance_session())

    result = await service.authorize_replay_upload(
        Mock(),
        "session-1",
        7,
        request=_authorization_request(),
    )

    assert result.artifact_id
    assert result.upload_method == "PUT"
    assert result.upload_headers["content-type"] == "application/vnd.noteverse.replay+json"
    assert result.upload_headers["x-amz-meta-sha256"] == REPLAY_CHECKSUM
    assert storage.upload_targets == [
        f"practice/replays/session-1/{result.artifact_id}.json"
    ]
    assert storage.objects == {}
    repository.create_replay_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_finalize_replay_artifact_creates_metadata_only_after_object_exists() -> None:
    service, repository, storage = _service(_finished_performance_session())
    authorization = await service.authorize_replay_upload(
        Mock(),
        "session-1",
        7,
        request=_authorization_request(),
    )
    object_key = f"practice/replays/session-1/{authorization.artifact_id}.json"
    storage.put_bytes(
        key=object_key,
        content=REPLAY_BYTES,
        content_type="application/vnd.noteverse.replay+json",
    )

    result = await service.finalize_replay_artifact(
        Mock(),
        "session-1",
        7,
        request=_finalize_request(authorization.artifact_id),
    )

    artifact = repository.create_replay_artifact.await_args.args[1]
    assert artifact.object_key == object_key
    assert artifact.storage_backend == "fake"
    assert artifact.byte_size == len(REPLAY_BYTES)
    assert artifact.checksum_sha256 == REPLAY_CHECKSUM
    assert result.session_id == "session-1"
    assert result.kind == PracticeReplayArtifactKind.MIDI_EVENTS
    assert result.input_source == PracticeInputSource.MIDI


@pytest.mark.asyncio
async def test_finalize_replay_artifact_is_idempotent_for_existing_artifact() -> None:
    existing = SimpleNamespace(
        artifact_uuid="artifact-1",
        session_id=11,
        kind=PracticeReplayArtifactKind.MIDI_EVENTS,
        input_source=PracticeInputSource.MIDI,
        storage_backend="fake",
        object_key="practice/replays/session-1/artifact-1.json",
        content_type="application/vnd.noteverse.replay+json",
        byte_size=len(REPLAY_BYTES),
        checksum_sha256=REPLAY_CHECKSUM,
        duration_ms=1200,
        timebase_version=1,
        format_version=1,
        created_at=SimpleNamespace(isoformat=lambda: "2026-09-01T00:00:00"),
    )
    service, repository, _storage = _service(
        _finished_performance_session(),
        existing_replay_artifact=existing,
    )

    result = await service.finalize_replay_artifact(
        Mock(),
        "session-1",
        7,
        request=_finalize_request("artifact-1"),
    )

    assert result.artifact_id == "artifact-1"
    repository.create_replay_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_finalize_replay_artifact_requires_uploaded_object() -> None:
    service, repository, _storage = _service(_finished_performance_session())

    with pytest.raises(ResourceNotFoundException) as error:
        await service.finalize_replay_artifact(
            Mock(),
            "session-1",
            7,
            request=_finalize_request("artifact-1"),
        )

    assert error.value.code == ErrorCode.FILE_NOT_FOUND
    repository.create_replay_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_authorize_replay_upload_requires_matching_performance_input_source() -> None:
    service, repository, storage = _service(
        _finished_performance_session(input_source=PracticeInputSource.MICROPHONE)
    )

    with pytest.raises(ValidationException) as error:
        await service.authorize_replay_upload(
            Mock(),
            "session-1",
            7,
            request=_authorization_request(),
        )

    assert error.value.code == ErrorCode.VALIDATION_ERROR
    assert error.value.details["field"] == "kind"
    assert storage.objects == {}
    repository.create_replay_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_authorize_audio_replay_upload_accepts_recorder_codec_parameter() -> None:
    service, repository, storage = _service(
        _finished_performance_session(input_source=PracticeInputSource.MICROPHONE)
    )

    result = await service.authorize_replay_upload(
        Mock(),
        "session-1",
        7,
        request=_audio_authorization_request("audio/webm;codecs=opus"),
    )

    assert result.content_type == "audio/webm"
    assert result.upload_headers["content-type"] == "audio/webm"
    assert storage.upload_targets == [
        f"practice/replays/session-1/{result.artifact_id}.webm"
    ]
    repository.create_replay_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_replay_artifact_playback_uses_plain_read_url_without_response_overrides() -> None:
    artifact = SimpleNamespace(
        artifact_uuid="artifact-1",
        session_id=11,
        kind=PracticeReplayArtifactKind.AUDIO_RECORDING,
        input_source=PracticeInputSource.MICROPHONE,
        storage_backend="fake",
        object_key="practice/replays/session-1/artifact-1.webm",
        content_type="audio/webm",
        byte_size=len(REPLAY_BYTES),
        checksum_sha256=REPLAY_CHECKSUM,
        duration_ms=1200,
        timebase_version=1,
        format_version=1,
        created_at=SimpleNamespace(isoformat=lambda: "2026-09-01T00:00:00"),
    )
    service, _repository, storage = _service(
        _finished_performance_session(input_source=PracticeInputSource.MICROPHONE),
        existing_replay_artifact=artifact,
    )
    storage.put_bytes(
        key=artifact.object_key,
        content=REPLAY_BYTES,
        content_type=artifact.content_type,
    )

    result = await service.get_replay_artifact_playback(Mock(), "session-1", 7, "artifact-1")

    assert result.playback_url == "https://storage.example/download/practice/replays/session-1/artifact-1.webm"
    assert result.content_type == "audio/webm"
    assert storage.download_requests == [
        {
            "key": "practice/replays/session-1/artifact-1.webm",
            "filename": None,
            "content_type": None,
        }
    ]


@pytest.mark.asyncio
async def test_delete_replay_artifact_removes_visible_row_and_queues_object_deletion() -> None:
    artifact = SimpleNamespace(
        artifact_uuid="artifact-1",
        session_id=11,
        kind=PracticeReplayArtifactKind.AUDIO_RECORDING,
        input_source=PracticeInputSource.MICROPHONE,
        storage_backend="fake",
        object_key="practice/replays/session-1/artifact-1.webm",
        content_type="audio/webm",
        byte_size=len(REPLAY_BYTES),
        checksum_sha256=REPLAY_CHECKSUM,
        duration_ms=1200,
        timebase_version=1,
        format_version=1,
        created_at=SimpleNamespace(isoformat=lambda: "2026-09-01T00:00:00"),
    )
    service, repository, storage = _service(
        _finished_performance_session(input_source=PracticeInputSource.MICROPHONE),
        existing_replay_artifact=artifact,
    )

    result = await service.delete_replay_artifact(Mock(), "session-1", 7, "artifact-1")

    deletion = repository.delete_replay_artifact_and_queue_object_deletion.await_args.args[2]
    assert result.artifact_id == "artifact-1"
    assert deletion.artifact_uuid == "artifact-1"
    assert deletion.storage_backend == "fake"
    assert deletion.object_key == "practice/replays/session-1/artifact-1.webm"
    assert deletion.status == PracticeReplayObjectDeletionStatus.PENDING
    assert storage.deleted == []
