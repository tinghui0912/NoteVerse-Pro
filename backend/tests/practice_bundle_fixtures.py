"""Application test ports for unbound canonical notation compilation."""

from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings

from tests.support.runtime_resources import resources_for


from types import SimpleNamespace
from app.modules.media_storage.persistence import object_from_bytes
from unittest.mock import Mock
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.practice.bundle.retention import PracticeBundleRetention
from app.runtime.customer_api.context import get_context


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
        writes=resources_for(
            Mock(read_bytes=Mock(return_value=content))
        ).build_object_write_coordinator(),
        retention=PracticeBundleRetention(
            config=StoredObjectRetirementSettings.model_validate(
                get_context().settings.model_dump()
            )
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
