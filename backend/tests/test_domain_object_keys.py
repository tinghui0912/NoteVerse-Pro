"""Each semantic object has a domain-owned, namespace-safe identity."""

import pytest

from app.modules.revisions.object_keys import canonical_revision_source_object_key
from app.modules.import_jobs.object_keys import review_musicxml_object_key
from app.modules.practice.bundle.object_keys import (
    practice_bundle_musicxml_object_key,
    practice_bundle_artifact_object_key,
)
from app.modules.performance_takes.object_keys import (
    performance_take_recording_object_key,
)
from app.modules.score_assets.render_asset_records import rendered_page_object_key
from app.modules.playback.asset_records import playback_audio_object_key
from app.modules.account.avatar_service import avatar_object_key


@pytest.mark.parametrize(
    "build,expected",
    [
        (
            lambda: canonical_revision_source_object_key(
                score_uuid="score", revision_uuid="revision"
            ),
            "scores/score/revisions/revision/score.musicxml",
        ),
        (
            lambda: review_musicxml_object_key(job_uuid="job", content_sha256="a" * 64),
            f"jobs/job/review_musicxml/{'a' * 64}/score.musicxml",
        ),
        (
            lambda: practice_bundle_musicxml_object_key("bundle"),
            "practice-bundles/bundle/score.musicxml",
        ),
        (
            lambda: practice_bundle_artifact_object_key("bundle"),
            "practice-bundles/bundle/artifact.json",
        ),
        (
            lambda: performance_take_recording_object_key(
                user_id=7,
                take_uuid="take",
                object_generation="attempt",
                media_kind="AUDIO",
                mime_type="audio/webm",
            ),
            "performance-takes/7/take/attempt.webm",
        ),
        (
            lambda: rendered_page_object_key(
                score_uuid="score",
                revision_uuid="revision",
                profile="screen",
                page=2,
                asset_uuid="page",
                extension=".svg",
            ),
            "scores/score/revisions/revision/renders/screen/002-page.svg",
        ),
        (
            lambda *args, **kwargs: playback_audio_object_key(
                score_uuid="score", revision_uuid="revision", asset_uuid="audio", extension=".wav"
            ),
            "scores/score/revisions/revision/playback/audio.wav",
        ),
        (lambda: avatar_object_key("7-avatar.jpg"), "avatars/7-avatar.jpg"),
    ],
)
def test_semantic_object_layout(build, expected):
    assert build() == expected
