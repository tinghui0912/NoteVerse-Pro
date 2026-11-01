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
    PracticeSourceRef,
)
from app.modules.practice.source.service import PracticeSourceService
from app.modules.practice.score.compiler.stable_ids import prepare_musicxml_ids_for_practice
from app.modules.practice.score.compiler.musicxml import compile_practice_score

FIXTURE = Path(__file__).parent / "fixtures/musicxml/score-domain-metadata.musicxml"


def test_source_value_prepares_once_and_artifact_uses_the_exact_prepared_notation():
    builder = PracticeSourceBuilder()
    with (
        patch(
            "app.modules.practice.source.builder.prepare_musicxml_ids_for_practice",
            wraps=prepare_musicxml_ids_for_practice,
        ) as prepare,
        patch(
            "app.modules.practice.source.builder.compile_practice_score",
            wraps=compile_practice_score,
        ) as compile_score,
    ):
        source_value = builder.build(
            score_id="score-1", revision_id="revision-1", canonical_musicxml=FIXTURE.read_bytes()
        )
    prepare.assert_called_once()
    compile_score.assert_called_once_with(source_value.prepared_musicxml.data)
    ids = {
        note.attrib["id"]
        for note in ET.fromstring(source_value.prepared_musicxml.data).iter("note")
        if "id" in note.attrib
    }
    assert {note["renderNoteId"] for note in source_value.artifact.value["notes"]} <= ids
    assert source_value.artifact.value["notes"]
    assert source_value.prepared_musicxml.byte_size == len(source_value.prepared_musicxml.data)
    # Consumers receive detached values; canonical immutable bytes own the artifact.
    source_value.artifact.value["notes"].clear()
    assert source_value.artifact.value["notes"]


def test_source_value_identity_is_deterministic_and_covers_both_representations():
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
@pytest.mark.parametrize("include_notation", [False, True])
async def test_source_request_builds_one_authorized_source_value(include_notation):
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
    repository = Mock()

    async def persist(db, candidate, *, live_revision_id):
        assert live_revision_id == 201
        return PracticeSourceRef(
            303,
            candidate.source_id,
            candidate.score_id,
            candidate.revision_id,
            candidate.artifact.artifact_id,
        ), candidate

    repository.get_or_create = AsyncMock(side_effect=persist)
    service = PracticeSourceService(
        access_policy=access_policy,
        asset_repository=assets,
        storage=storage,
        repository=repository,
    )
    with patch.object(service.builder, "build", wraps=service.builder.build) as build:
        source = await service.read_source(
            AsyncMock(), "score-1", 1, "revision-1", include_notation=include_notation
        )
    build.assert_called_once()
    access_policy.authorize.assert_awaited_once()
    assert source.artifact.scoreId == "score-1"
    assert source.artifact.revisionId == "revision-1"
    assert (source.notation is not None) == include_notation
    if source.notation:
        ids = {
            note.attrib["id"]
            for note in ET.fromstring(source.notation.musicxml).iter("note")
            if "id" in note.attrib
        }
        assert {note.renderNoteId for note in source.artifact.notes} <= ids

    repository.get_or_create.assert_awaited_once()
    persisted = repository.get_or_create.await_args.args[1]
    assert source.source_id == persisted.source_id


@pytest.mark.asyncio
@pytest.mark.parametrize("include_notation", [False, True])
async def test_durable_request_reads_one_verified_source_value(include_notation):
    source_value = PracticeSourceBuilder().build(
        score_id="s", revision_id="r", canonical_musicxml=FIXTURE.read_bytes()
    )
    repository = Mock()
    repository.read = AsyncMock(return_value=source_value)
    service = PracticeSourceService(repository=repository)
    db = AsyncMock()
    source = await service.read_source_by_id(db, 42, include_notation=include_notation)
    repository.read.assert_awaited_once_with(db, 42)
    assert source.source_id == source_value.source_id
    assert source.artifact.artifactId == source_value.artifact.artifact_id
    if include_notation:
        assert source.notation.musicxml == source_value.prepared_musicxml.content
    else:
        assert source.notation is None


@pytest.mark.asyncio
async def test_exact_source_authorization_requires_consistent_live_owner():
    from app.core.exceptions import ValidationException
    from app.modules.practice.source.repository import PracticeSourceResolution

    source = PracticeSourceBuilder().build(
        score_id="score-1", revision_id="revision-1", canonical_musicxml=FIXTURE.read_bytes()
    )
    repository = Mock()
    reference = PracticeSourceRef(
        303, source.source_id, source.score_id, source.revision_id, source.artifact.artifact_id
    )
    repository.require_ready_by_source_id = AsyncMock(
        return_value=PracticeSourceResolution(reference, 201)
    )
    repository.read_by_source_id = AsyncMock(return_value=source)
    policy = Mock()
    policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=101, score_uuid="score-1"),
            revision=SimpleNamespace(id=202, score_id=101, revision_uuid="revision-1"),
        )
    )
    service = PracticeSourceService(repository=repository, access_policy=policy)
    with pytest.raises(ValidationException) as caught:
        await service.authorize_source_by_source_id(AsyncMock(), 1, source.source_id)
    assert caught.value.details["reason"] == "practice_source_owner_mismatch"
    repository.read_by_source_id.assert_not_awaited()
