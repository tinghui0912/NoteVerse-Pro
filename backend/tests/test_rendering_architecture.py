"""Revision presentation owns durable rendering; renderer capabilities are stateless."""

import ast
from pathlib import Path

from sqlalchemy import UniqueConstraint
from app.db.models import ScoreRevisionRenderOutbox, ScoreRevisionRenderStatus
from app.modules.revisions.render_delivery import _delivery_lifecycle, revision_render_delivery
from app.modules.revisions.render_target import ScoreRevisionRenderTarget
from app.modules.durable_work.delivery import DurableDeliveryLifecycle

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
    assert revision_render_delivery.__class__.__module__ == "app.modules.revisions.render_delivery"
    assert isinstance(_delivery_lifecycle(), DurableDeliveryLifecycle)
    assert "app.modules.revisions.render_admission" in imports("modules/revisions/writer.py")
    assert "app.modules.revisions.render_delivery" in imports(
        "modules/revisions/render_dispatch.py"
    )
    assert "app.modules.revisions.render_dispatch" in imports(
        "worker/execution/maintenance_dispatch.py"
    )
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
    assert "app.modules.score_assets.score_revision_rendering" in imports(
        "worker/execution/score_revision_render_outbox.py"
    )
    assert "app.modules.revisions.render_delivery" in imports(
        "modules/score_assets/score_revision_rendering.py"
    )
