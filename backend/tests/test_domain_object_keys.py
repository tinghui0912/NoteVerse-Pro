"""Each semantic object has a domain-owned, namespace-safe identity."""

import pytest

from app.modules.revisions.object_keys import canonical_revision_source_object_key
from app.modules.import_jobs.object_keys import review_musicxml_object_key
from app.modules.practice.bundle.object_keys import (
    practice_bundle_musicxml_object_key,
    practice_bundle_artifact_object_key,
)
from app.modules.performance_takes.object_keys import (
    performance_take_staging_object_key,
    performance_take_recording_object_key,
)
from app.modules.performance_takes.generated.recording_media_admission import (
    ORIGINAL_RECORDING_CONTAINERS,
)
from app.modules.score_assets.render_asset_records import rendered_page_object_key
from app.modules.playback.asset_records import playback_audio_object_key
from app.modules.uploads.service import blob_object_key
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
            lambda: performance_take_staging_object_key(
                user_id=7, take_uuid="take", media_kind="AUDIO", mime_type="audio/webm"
            ),
            "staging/performance-takes/7/take/recording.webm",
        ),
        (
            lambda: performance_take_recording_object_key(
                user_id=7,
                take_uuid="take",
                finalize_token="attempt",
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
            lambda: playback_audio_object_key(
                score_uuid="score", revision_uuid="revision", asset_uuid="audio", extension=".wav"
            ),
            "scores/score/revisions/revision/playback/audio.wav",
        ),
        (lambda: blob_object_key("a" * 64, ".png"), f"blobs/aa/{'a' * 64}.png"),
        (lambda: avatar_object_key("7-avatar.jpg"), "avatars/7-avatar.jpg"),
    ],
)
def test_semantic_object_layout(build, expected):
    assert build() == expected


@pytest.mark.parametrize("component", ["", ".", "..", "a/b", "a\\b"])
@pytest.mark.parametrize(
    "build",
    [
        lambda value: canonical_revision_source_object_key(
            score_uuid=value, revision_uuid="revision"
        ),
        lambda value: canonical_revision_source_object_key(score_uuid="score", revision_uuid=value),
        lambda value: review_musicxml_object_key(job_uuid=value, content_sha256="a" * 64),
        practice_bundle_musicxml_object_key,
        practice_bundle_artifact_object_key,
        lambda value: performance_take_staging_object_key(
            user_id=7, take_uuid=value, media_kind="AUDIO", mime_type="audio/webm"
        ),
        lambda value: performance_take_recording_object_key(
            user_id=7,
            take_uuid="take",
            finalize_token=value,
            media_kind="AUDIO",
            mime_type="audio/webm",
        ),
        lambda value: rendered_page_object_key(
            score_uuid="score",
            revision_uuid="revision",
            profile=value,
            page=1,
            asset_uuid="asset",
            extension=".svg",
        ),
        lambda value: playback_audio_object_key(
            score_uuid="score", revision_uuid="revision", asset_uuid=value, extension=".wav"
        ),
        avatar_object_key,
    ],
)
def test_semantic_identity_cannot_escape_its_namespace(build, component):
    with pytest.raises(ValueError):
        build(component)


@pytest.mark.parametrize("digest", ["", ".", "..", "a/b", "a\\b", "a" * 63, "A" * 64])
def test_content_address_requires_a_full_canonical_digest(digest):
    with pytest.raises(ValueError):
        review_musicxml_object_key(job_uuid="job", content_sha256=digest)
    with pytest.raises(ValueError):
        blob_object_key(digest, ".png")


@pytest.mark.parametrize("container", ORIGINAL_RECORDING_CONTAINERS)
def test_recording_keys_project_media_admission_and_finalize_generation(container):
    kwargs = dict(
        user_id=7, take_uuid="take", media_kind=container.kind, mime_type=container.mime_type
    )
    assert (
        performance_take_staging_object_key(**kwargs)
        == f"staging/performance-takes/7/take/recording.{container.extension}"
    )
    first = performance_take_recording_object_key(**kwargs, finalize_token="first")
    second = performance_take_recording_object_key(**kwargs, finalize_token="second")
    assert first == f"performance-takes/7/take/first.{container.extension}"
    assert second != first and second.endswith(f"/second.{container.extension}")


def test_recording_keys_require_an_admitted_container():
    with pytest.raises(ValueError, match="Unsupported original recording container"):
        performance_take_staging_object_key(
            user_id=7, take_uuid="take", media_kind="AUDIO", mime_type="image/png"
        )
    with pytest.raises(ValueError, match="Unsupported original recording container"):
        performance_take_recording_object_key(
            user_id=7,
            take_uuid="take",
            finalize_token="attempt",
            media_kind="AUDIO",
            mime_type="image/png",
        )
