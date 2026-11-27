"""Application test ports for unbound canonical notation compilation."""

from app.composition import storage_resources as _resource_wiring

from types import SimpleNamespace
from app.modules.media_storage.persistence import object_from_bytes
from unittest.mock import Mock
from app.modules.practice.bundle.service import PracticeBundleService


def bundle_service_for_notation(content: bytes):
    source = object_from_bytes(
        object_key="canonical.xml", content=content, content_type="application/xml"
    )
    source.id = 1
    return PracticeBundleService(
        asset_repository=Mock(
            canonical_source=Mock(return_value=SimpleNamespace(stored_object=source))
        ),
        repository=Mock(read_bound=Mock(return_value=None)),
        writes=_resource_wiring.build_object_write_coordinator(
            Mock(read_bytes=Mock(return_value=content))
        ),
    )


def authorize_test_revision(monkeypatch):
    access = SimpleNamespace(
        score=SimpleNamespace(id=1, score_uuid="s", title="Score"),
        revision=SimpleNamespace(id=2, revision_uuid="r"),
    )
    monkeypatch.setattr(
        "app.modules.practice.bundle.service.lock_live_practice_mutation_access",
        Mock(return_value=access),
    )
    monkeypatch.setattr(
        "app.modules.practice.bundle.service.ScoreAccessPolicy.authorize_revision",
        Mock(return_value=access),
    )
