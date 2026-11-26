"""ORM contracts shared by domain-owned delivery and failure persistence."""

import ast
import importlib
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlmodel import SQLModel

from app.db import durable_delivery
from app.db.models import (
    AccountDeletionOperation,
    ImportDispatch,
    ImportJob,
    MailOutbox,
    ObjectWriteIntent,
    PlaybackOutbox,
    ScoreRevisionRenderOutbox,
    RevisionMetadataOutbox,
    ScoreDeletionOperation,
    StoredObjectRetirement,
)
from app.modules.durable_work import delivery, failure
from app.shared import durable_failure, realtime
from app.modules.performance_takes.upload_reservation import states as reservation_states
from app.shared.durable_failure import DurableFailureClass
from app.shared.time import utc_now

DELIVERIES = (
    AccountDeletionOperation,
    ImportDispatch,
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    MailOutbox,
    ScoreDeletionOperation,
    RevisionMetadataOutbox,
    StoredObjectRetirement,
    ObjectWriteIntent,
)
STRUCTURED_FAILURES = (
    AccountDeletionOperation,
    StoredObjectRetirement,
    ImportJob,
    ImportDispatch,
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    MailOutbox,
    ScoreDeletionOperation,
)
DETAIL_ONLY = (RevisionMetadataOutbox, ObjectWriteIntent)
FAILURE_LENGTHS = {"failure_code": 128, "failure_stage": 64, "failure_classification": 32}


@pytest.mark.parametrize("model", DELIVERIES)
def test_attempt_columns_and_per_instance_defaults(model):
    before = utc_now()
    first, second = model(), model()
    after = utc_now()
    for row in (first, second):
        assert row.attempt_count == 0
        assert before <= row.next_attempt_at <= after
        assert row.next_attempt_at.utcoffset().total_seconds() == 0
        for name in (
            "attempt_token",
            "dispatched_at",
            "started_at",
            "completed_at",
            "failure_detail",
        ):
            assert getattr(row, name) is None
    assert first.next_attempt_at is not second.next_attempt_at
    assert model.model_fields["next_attempt_at"].default_factory is utc_now
    columns = model.__table__.c
    assert isinstance(columns.attempt_count.type, sa.Integer)
    assert not columns.attempt_count.nullable
    assert columns.attempt_token.type.length == 36
    assert columns.attempt_token.nullable
    for name in ("next_attempt_at", "dispatched_at", "started_at", "completed_at"):
        assert isinstance(columns[name].type, sa.DateTime)
        assert columns[name].type.timezone is True
        assert columns[name].nullable is (name != "next_attempt_at")
    assert isinstance(columns.failure_detail.type, sa.Text)
    assert columns.failure_detail.nullable
    # Revision metadata supplies these defaults at construction rather than in SQL.
    if model is RevisionMetadataOutbox:
        assert columns.attempt_count.default is None
        assert columns.next_attempt_at.default is None
    else:
        assert columns.attempt_count.default.arg == 0
        assert columns.next_attempt_at.default.is_callable


def test_factories_create_independent_columns_without_registering_a_table():
    tables = set(SQLModel.metadata.tables)
    importlib.reload(durable_delivery)
    assert set(SQLModel.metadata.tables) == tables
    assert {model.__tablename__ for model in DELIVERIES} == {
        "account_deletion_operations",
        "import_dispatches",
        "score_revision_render_outbox",
        "playback_outbox",
        "mail_outbox",
        "score_deletion_operations",
        "revision_metadata_outbox",
        "stored_object_retirements",
        "object_write_intents",
    }
    for name in (
        "attempt_count",
        "attempt_token",
        "next_attempt_at",
        "dispatched_at",
        "started_at",
        "completed_at",
        "failure_detail",
    ):
        columns = [model.__table__.c[name] for model in DELIVERIES]
        assert len({id(column) for column in columns}) == len(DELIVERIES)
        for model, column in zip(DELIVERIES, columns, strict=True):
            assert column.table is model.__table__
    for model in DELIVERIES:
        assert "status" in model.__table__.c
        assert "status" not in vars(durable_delivery)


@pytest.mark.parametrize("model", STRUCTURED_FAILURES)
def test_structured_failure_columns_have_the_same_nullable_schema(model):
    columns = model.__table__.c
    for name, length in FAILURE_LENGTHS.items():
        assert isinstance(columns[name].type, sa.String)
        assert columns[name].type.length == length
        assert columns[name].nullable
        assert getattr(model(), name) is None
    assert isinstance(columns.failure_retryable.type, sa.Boolean)
    assert columns.failure_retryable.nullable
    assert model().failure_retryable is None
    predicates = [
        constraint
        for constraint in model.__table__.constraints
        if constraint.name and constraint.name.endswith("_failure_facts")
    ]
    assert len(predicates) == 1
    assert str(predicates[0].sqltext) == str(
        durable_delivery.durable_failure_facts_constraint(name="contract").sqltext
    )
    expression = str(predicates[0].sqltext)
    classifications = expression.split(" IN (", 1)[1].split(")", 1)[0]
    assert {value.strip().strip("'") for value in classifications.split(",")} == {
        value.value for value in DurableFailureClass
    }


@pytest.mark.parametrize("model", DETAIL_ONLY)
def test_detail_only_records_do_not_own_structured_failure_facts(model):
    assert "failure_detail" in model.__table__.c
    assert not (set(FAILURE_LENGTHS) | {"failure_retryable"}) & set(model.__table__.c.keys())


@pytest.mark.parametrize(
    "module", (delivery, failure, durable_failure, reservation_states, realtime)
)
def test_transition_and_failure_mechanics_depend_only_on_pure_behavior(module):
    import sys

    tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0
            names = [node.module]
        else:
            continue
        assert all(
            name.split(".")[0] in sys.stdlib_module_names
            or (module is delivery and name == "app.modules.durable_work.failure")
            or (module is failure and name == "app.shared.durable_failure")
            for name in names
        )


def test_database_layer_only_imports_domain_owned_state_taxonomies():
    from importlib.util import resolve_name

    db_root = Path(durable_delivery.__file__).parent
    for path in db_root.rglob("*.py"):
        package = ".".join(path.parent.relative_to(db_root.parent.parent).parts)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                module = resolve_name("." * node.level + (node.module or ""), package)
                names = [module, *(module + "." + alias.name for alias in node.names)]
            else:
                continue
            allowed = {
                "app.modules.media_storage.domain",
                "app.modules.storage_governance.usage.domain",
                "app.modules.storage_governance.quota.states",
                "app.modules.performance_takes.upload_reservation.states",
                "app.modules.practice.bundle.states",
                "app.modules.revisions.domain",
                "app.modules.revisions.render_states",
                "app.modules.score_assets.domain",
                "app.modules.scores.domain",
                "app.modules.metadata.domain",
                "app.modules.metadata.delivery_states",
                "app.modules.playback.domain",
                "app.modules.import_jobs.domain",
            }
            for name in names:
                if name.startswith("app.modules."):
                    assert any(
                        name == owner or name.startswith(owner + ".") for owner in allowed
                    ), (path, name)


def test_shared_taxonomy_is_the_failure_classification_authority():
    assert DurableFailureClass.__module__ == "app.shared.durable_failure"
    assert failure.DurableFailure.__annotations__["classification"] is DurableFailureClass
    assert {value.value for value in DurableFailureClass} == {
        "transient",
        "permanent",
        "user_error",
        "system_error",
    }
