"""Application test ports for unbound canonical notation compilation."""

from types import SimpleNamespace
from app.modules.storage_objects.persistence import object_from_bytes
from unittest.mock import AsyncMock, Mock
from app.modules.practice.bundle.service import PracticeBundleService


def bundle_service_for_notation(content: bytes):
    return PracticeBundleService(
        storage=Mock(read_bytes=Mock(return_value=content)),
        asset_repository=Mock(
            canonical_source=AsyncMock(
                return_value=SimpleNamespace(
                    stored_object=object_from_bytes(
                        object_key="canonical.xml", content=content, content_type="application/xml"
                    )
                )
            )
        ),
        repository=Mock(read_bound=AsyncMock(return_value=None)),
    )


def authorize_test_revision(monkeypatch):
    access = SimpleNamespace(
        score=SimpleNamespace(id=1, score_uuid="s", title="Score"),
        revision=SimpleNamespace(id=2, revision_uuid="r"),
    )
    monkeypatch.setattr(
        "app.modules.practice.bundle.service.lock_live_practice_mutation_access",
        AsyncMock(return_value=access),
    )
    monkeypatch.setattr(
        "app.modules.practice.bundle.service.ScoreAccessPolicy.authorize",
        AsyncMock(return_value=access),
    )
