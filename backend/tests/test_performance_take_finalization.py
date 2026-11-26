"""Verified physical evidence is independent of persistence and lifecycle transitions."""

import hashlib
import pytest
from app.modules.performance_takes.manifest import TakeManifest
from app.modules.performance_takes.schemas import PerformanceTakeManifestRead
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


def test_verifier_observes_full_bytes_without_persistence(manifest):
    from app.modules.media_storage.verification import ObjectIntegrityVerifier
    from app.modules.media_storage.facts import StoredObjectFacts

    storage = InMemoryObjectStorage()
    storage.put_bytes(key="recording", content=MEDIA, content_type="audio/webm")
    result = ObjectIntegrityVerifier(storage).verify(
        StoredObjectFacts("recording", len(MEDIA), None, "audio/webm")
    )
    assert result.digest == hashlib.sha256(MEDIA).hexdigest() and result.prefix == MEDIA
