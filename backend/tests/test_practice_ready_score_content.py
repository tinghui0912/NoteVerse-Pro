from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.db.models.score_access import AccessOrigin
from app.modules.practice.service import PracticeService


@pytest.mark.asyncio
async def test_practice_service_returns_practice_ready_musicxml_content() -> None:
    access_policy = Mock()
    access_policy.authorize = AsyncMock(
        return_value=SimpleNamespace(
            score=SimpleNamespace(id=101, score_uuid="score-1"),
            revision=SimpleNamespace(id=201, revision_uuid="revision-1"),
            origin=AccessOrigin.OWNER,
            grant=None,
        )
    )
    asset_repository = Mock()
    asset_repository.canonical_source = AsyncMock(
        return_value=SimpleNamespace(
            storage_key="scores/score-1/revisions/revision-1/score.musicxml"
        )
    )
    storage = Mock()
    with tempfile.NamedTemporaryFile("w", suffix=".musicxml", delete=False) as file:
        file.write(
            '<score-partwise><part id="P1"><measure number="A"><note /></measure></part></score-partwise>'
        )
        score_path = file.name
    storage.local_path.return_value = score_path
    storage.materialize_to_local.return_value = score_path
    service = PracticeService(
        access_policy=access_policy,
        asset_repository=asset_repository,
        storage=storage,
    )

    try:
        result = await service.get_practice_ready_score_content(
            AsyncMock(),
            score_uuid="score-1",
            user_id=1,
            revision_uuid="revision-1",
        )
    finally:
        os.unlink(score_path)

    assert result.score_id == "score-1"
    assert result.revision_id == "revision-1"
    assert result.mime_type == "application/vnd.recordare.musicxml+xml"
    assert 'id="nv-p1-m1-note1"' in result.content
