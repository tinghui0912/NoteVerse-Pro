"""Revision presentation owns durable rendering; renderer capabilities are stateless."""

import ast
import inspect
from typing import get_type_hints
from pathlib import Path

from sqlalchemy import UniqueConstraint
from app.db.models import ScoreRevisionRenderOutbox
from app.modules.revisions.render_states import ScoreRevisionRenderStatus
from app.modules.revisions.render_delivery import _delivery_lifecycle
from app.modules.revisions.render_target import ScoreRevisionRenderTarget
from app.modules.durable_work.delivery import DurableDeliveryLifecycle
from tests.support.runtime_resources import deliveries
from app.platform.config.revision_render_delivery import RevisionRenderDeliverySettings
from app.runtime.customer_api.context import get_context

ROOT = Path(__file__).parents[1] / "app"


def imports(relative):
    return {
        n.module
        for n in ast.walk(ast.parse((ROOT / relative).read_text(encoding="utf-8")))
        if isinstance(n, ast.ImportFrom) and n.module
    }


def test_revision_render_record_has_one_revision_profile_identity():
    table = ScoreRevisionRenderOutbox.__table__
    assert table.name == "score_revision_render_outbox"
    assert table.c.status.type.enum_class is ScoreRevisionRenderStatus
    assert all(
        not table.c[name].nullable
        for name in ("score_id", "revision_id", "source_fingerprint", "render_profile")
    )
    identities = {
        tuple(c.name for c in item.columns)
        for item in table.constraints
        if isinstance(item, UniqueConstraint)
    }
    assert ("revision_id", "render_profile") in identities
    assert {fk.target_fullname for fk in table.foreign_keys} == {
        "scores.id",
        "score_revisions.id",
        "users.id",
    }


def test_revision_domain_owns_durable_admission_and_dispatch():
    assert deliveries().render.__class__.__module__ == "app.modules.revisions.render_delivery"
    assert isinstance(
        _delivery_lifecycle(
            config=RevisionRenderDeliverySettings.model_validate(
                get_context().settings.model_dump()
            )
        ),
        DurableDeliveryLifecycle,
    )
    assert "app.modules.revisions.render_admission" in imports("modules/revisions/writer.py")
    assert "app.modules.revisions.render_delivery" in imports("composition/dispatch/render.py")
    assert "app.runtime.worker.context" in imports("worker/execution/maintenance_dispatch.py")
    for file in (ROOT / "modules/import_jobs/review").glob("*.py"):
        dependencies = imports(str(file.relative_to(ROOT)))
        assert all(not name.startswith("app.modules.revisions.render_") for name in dependencies)


def test_renderer_capability_and_revision_execution_have_distinct_owners():
    assert {p.stem for p in (ROOT / "modules/rendering").glob("*.py")} == {
        "__init__",
        "renderer",
        "execution_manifest",
    }
    assert set(ScoreRevisionRenderTarget.__dataclass_fields__) == {
        "outbox_uuid",
        "score_uuid",
        "revision_uuid",
        "requested_by_user_id",
        "render_profile",
        "source_fingerprint",
        "originating_request_id",
        "traceparent",
        "tracestate",
    }
    assert "app.runtime.worker.context" in imports(
        "worker/execution/score_revision_render_outbox.py"
    )
    assert "app.modules.revisions.render_delivery" in imports(
        "modules/score_assets/score_revision_rendering.py"
    )


def test_revision_render_asset_mutation_requires_durable_execution_ownership():
    from app.modules.score_assets.score_revision_rendering import ScoreRevisionRenderService
    from app.modules.durable_work.delivery import DeliveryAttemptLease

    public_operations = {
        name
        for name, method in inspect.getmembers(ScoreRevisionRenderService, inspect.isfunction)
        if not name.startswith("_")
    }
    assert public_operations == {"render_for_worker"}
    execution = ScoreRevisionRenderService.render_for_worker
    signature = inspect.signature(execution)
    for name in ("outbox_uuid", "lease", "source_fingerprint", "profile"):
        parameter = signature.parameters[name]
        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is inspect.Parameter.empty
    assert get_type_hints(execution)["lease"] is DeliveryAttemptLease
    assert set(inspect.signature(ScoreRevisionRenderService).parameters) == {
        "writes",
        "usage",
        "delivery",
        "work_root",
    }


def test_rendered_page_variant_identity_is_required_in_persistence_and_public_contract():
    from app.db.models import ScoreRenderAsset
    from app.modules.score_assets.schemas import RenderAssetRead
    from app.modules.score_assets.render_asset_records import build_render_asset_record

    fields = {"render_profile": str, "page_number": int}
    table = ScoreRenderAsset.__table__
    schema = RenderAssetRead.model_json_schema()
    for name, value_type in fields.items():
        assert ScoreRenderAsset.model_fields[name].annotation is value_type
        assert ScoreRenderAsset.model_fields[name].is_required()
        column = table.c[name]
        assert not column.nullable
        assert column.default is None and column.server_default is None
        assert name in schema["required"]
        assert schema["properties"][name]["type"] == ("string" if value_type is str else "integer")
    identities = {
        tuple(c.name for c in item.columns)
        for item in table.constraints
        if isinstance(item, UniqueConstraint)
    }
    assert ("revision_id", "kind", "render_profile", "page_number") in identities
    parameters = inspect.signature(build_render_asset_record).parameters
    for name in ("profile", "page_number"):
        assert parameters[name].default is inspect.Parameter.empty
