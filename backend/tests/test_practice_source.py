from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
import xml.etree.ElementTree as ET

import pytest

from app.db.models.score_access import AccessOrigin
from app.modules.practice.source.builder import PracticeSourceBuilder
from app.modules.practice.source.domain import (
    PracticeSourceRepresentation,
    PracticeSourceSnapshotRef,
)
from app.modules.practice.source.service import PracticeSourceService
from app.processing.practice_score.musicxml_stable_ids import prepare_musicxml_ids_for_practice

FIXTURE = Path(__file__).parent / "fixtures/musicxml/score-domain-metadata.musicxml"


def test_bundle_prepares_once_and_artifact_uses_the_exact_prepared_notation():
    builder = PracticeSourceBuilder()
    with (
        patch(
            "app.modules.practice.source.builder.prepare_musicxml_ids_for_practice",
            wraps=prepare_musicxml_ids_for_practice,
        ) as prepare,
        patch(
            "app.processing.practice_score.musicxml_stable_ids.prepare_musicxml_ids_for_practice",
            prepare,
        ),
    ):
        bundle = builder.build(
            score_id="score-1", revision_id="revision-1", canonical_musicxml=FIXTURE.read_bytes()
        )
    prepare.assert_called_once()
    ids = {
        note.attrib["id"]
        for note in ET.fromstring(bundle.prepared_musicxml.data).iter("note")
        if "id" in note.attrib
    }
    assert {note["renderNoteId"] for note in bundle.artifact.value["notes"]} <= ids
    assert bundle.artifact.value["notes"]
    assert bundle.prepared_musicxml.byte_size == len(bundle.prepared_musicxml.data)
    # Consumers receive detached values; canonical immutable bytes own the artifact.
    bundle.artifact.value["notes"].clear()
    assert bundle.artifact.value["notes"]


def test_bundle_identity_is_deterministic_and_covers_both_representations():
    builder = PracticeSourceBuilder()
    first = builder.build(score_id="s", revision_id="r", canonical_musicxml=FIXTURE.read_bytes())
    second = builder.build(score_id="s", revision_id="r", canonical_musicxml=FIXTURE.read_bytes())
    assert first == second
    assert first.source_id == second.source_id
    changed = replace(
        first,
        prepared_musicxml=PracticeSourceRepresentation(
            first.prepared_musicxml.data + b"\n", first.prepared_musicxml.mime_type
        ),
    )
    assert changed.source_id != first.source_id
    changed_artifact = replace(
        first,
        artifact=replace(
            first.artifact,
            representation=PracticeSourceRepresentation(
                first.artifact.representation.data + b"\n", "application/json"
            ),
        ),
    )
    assert changed_artifact.source_id != first.source_id
    assert replace(first, revision_id="other").source_id != first.source_id


@pytest.mark.asyncio
async def test_live_representations_share_source_identity_and_authorized_revision():
    access_policy = Mock()
    access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=101, score_uuid="score-1", title="Score"),
            revision=SimpleNamespace(id=201, revision_uuid="revision-1"),
            origin=AccessOrigin.OWNER,
            grant=None,
        )
    )
    assets = Mock()
    assets.canonical_source = AsyncMock(return_value=SimpleNamespace(storage_key="score.musicxml"))
    storage = Mock()
    storage.materialize_to_local.return_value = str(FIXTURE)
    service = PracticeSourceService(
        access_policy=access_policy, asset_repository=assets, storage=storage
    )
    content = await service.get_content(AsyncMock(), "score-1", 1, "revision-1")
    artifact = await service.get_artifact(AsyncMock(), "score-1", 1, "revision-1")
    assert content.source_id == artifact.source_id
    assert content.score_id == artifact.artifact.scoreId == "score-1"
    assert content.revision_id == artifact.artifact.revisionId == "revision-1"
    assert len(access_policy.authorize.await_args_list) == 2  # one resolution per request

    access_policy.authorize.reset_mock()
    service.repository.materialize = AsyncMock(
        return_value=PracticeSourceSnapshotRef(
            303,
            content.source_id,
            "score-1",
            "revision-1",
            artifact.artifact.artifactId,
        )
    )
    pinned = await service.pin_source(
        AsyncMock(),
        user_id=1,
        score_id="score-1",
        revision_id="revision-1",
        expected_artifact_id=artifact.artifact.artifactId,
    )
    access_policy.authorize.assert_awaited_once()
    assert (pinned.score_db_id, pinned.revision_db_id, pinned.score_title) == (101, 201, "Score")
    assert pinned.snapshot.source_id == content.source_id
    assert (
        service.repository.materialize.await_args.args[1].prepared_musicxml.content
        == content.content
    )
