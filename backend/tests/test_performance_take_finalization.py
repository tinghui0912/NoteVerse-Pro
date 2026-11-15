"""Verified physical evidence is independent of persistence and lifecycle transitions."""

from datetime import timedelta
from dataclasses import replace, FrozenInstanceError
from unittest.mock import patch
import hashlib
import pytest
from app.core.exceptions import ValidationException, ResourceNotFoundException
from app.modules.performance_takes.final_media import PerformanceTakeFinalMedia
from app.modules.performance_takes.manifest import TakeManifest
from app.modules.performance_takes.schemas import PerformanceTakeManifestRead
from app.modules.performance_takes.upload_reservation.domain import FinalizeLease
from app.storage.base import ObjectMetadata
from app.shared.time import utc_now
from tests.support.object_storage import InMemoryObjectStorage

MEDIA = b"\x1a\x45\xdf\xa3" + b"a full recording body"


@pytest.fixture
def manifest():
    return TakeManifest(
        "take",
        1,
        PerformanceTakeManifestRead.model_validate(
            {
                "artifact_id": "artifact",
                "score_display_title_snapshot": "Score",
                "practice_binding": {
                    "score_id": "score",
                    "revision_id": "revision",
                    "bundle_id": "bundle",
                },
                "capture": {"kind": "AUDIO", "mime_type": "audio/webm", "byte_size": len(MEDIA)},
                "score_timebase": {"ticks_per_quarter": 1},
                "scope": {"kind": "FULL", "start_tick": 0, "terminal_tick": 1},
                "tempo_plan": {
                    "selection": {"mode": "SCORE"},
                    "segments": [{"startTick": 0, "bpm": 120, "source": "MUSICXML"}],
                },
                "recording_timebase": {
                    "nominalMediaDurationUs": 1000000,
                    "activeSegments": [
                        {
                            "performanceStartUs": 0,
                            "performanceEndUs": 1000000,
                            "mediaStartUs": 0,
                            "mediaEndUs": 1000000,
                        }
                    ],
                },
            }
        ),
    )


@pytest.mark.parametrize(
    "failure",
    [
        None,
        "missing",
        "size",
        "mime",
        "signature",
        "copy",
        "candidate_size",
        "candidate_mime",
        "candidate_hash",
    ],
)
def test_media_verifier_requires_full_agreement_and_never_deletes(manifest, failure):
    storage = InMemoryObjectStorage()
    content = MEDIA if failure != "signature" else b"x" * len(MEDIA)
    if failure != "missing":
        storage.put_bytes(key="staging", content=content, content_type="audio/webm")
    lease = FinalizeLease("token", "candidate", utc_now() + timedelta(minutes=15))
    metadata = storage.object_metadata
    copy = storage.copy

    def observed_metadata(key):
        value = metadata(key)
        if (key == "staging" and failure == "size") or (
            key == "candidate" and failure == "candidate_size"
        ):
            return ObjectMetadata(size_bytes=value.size_bytes + 1, content_type=value.content_type)
        if (key == "staging" and failure == "mime") or (
            key == "candidate" and failure == "candidate_mime"
        ):
            return ObjectMetadata(size_bytes=value.size_bytes, content_type="audio/ogg")
        return value

    def copy_candidate(source, target):
        if failure == "copy":
            raise RuntimeError("provider copy failed")
        copy(source, target)
        if failure == "candidate_hash":
            storage.put_bytes(key=target, content=MEDIA[:-1] + b"!", content_type="audio/webm")

    with (
        patch.object(storage, "object_metadata", side_effect=observed_metadata),
        patch.object(storage, "copy", side_effect=copy_candidate),
        patch.object(
            storage, "delete", side_effect=AssertionError("cleanup owns physical deletion")
        ),
    ):
        verifier = PerformanceTakeFinalMedia(storage)
        if failure:
            with pytest.raises((ValidationException, ResourceNotFoundException, RuntimeError)):
                verifier.verify(manifest, lease, "staging")
        else:
            candidate = verifier.verify(manifest, lease, "staging")
            candidate.validate(manifest)
            assert candidate.object_facts.sha256 == hashlib.sha256(MEDIA).hexdigest()
            assert candidate.object_facts.object_key == lease.object_key
            assert candidate.manifest_sha256 == manifest.document_sha256
            with pytest.raises(FrozenInstanceError):
                candidate.take_uuid = "other"
            with pytest.raises(ValidationException):
                replace(candidate, take_uuid="other").validate(manifest)
