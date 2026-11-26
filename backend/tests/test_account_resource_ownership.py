"""Every actual ownership edge has a deliberate reviewed erasure policy."""

from sqlmodel import SQLModel
from app.db import models  # noqa: F401
from app.modules.account.resource_ownership import ACCOUNT_RESOURCE_POLICIES
from app.modules.media_storage.references import SEMANTIC_REFERENCES


def test_every_user_foreign_key_has_an_explicit_account_erasure_policy():
    actual = {
        (table.name, fk.parent.name)
        for table in SQLModel.metadata.tables.values()
        for fk in table.foreign_keys
        if fk.column.table.name == "users"
    }
    declared = {(policy.table, policy.user_column) for policy in ACCOUNT_RESOURCE_POLICIES}
    assert actual == declared
    assert len(declared) == len(ACCOUNT_RESOURCE_POLICIES)
    assert all(
        policy.domain and policy.ownership and policy.erasure
        for policy in ACCOUNT_RESOURCE_POLICIES
    )


def test_all_semantic_stored_object_references_have_explicit_protection():
    actual = {
        (table.name, fk.parent.name)
        for table in SQLModel.metadata.tables.values()
        for fk in table.foreign_keys
        if fk.column.table.name == "stored_objects" and table.name != "stored_object_retirements"
    }
    declared = {(column.table.name, column.name) for column in SEMANTIC_REFERENCES}
    assert actual == declared
    assert all(
        fk.ondelete == "RESTRICT" for column in SEMANTIC_REFERENCES for fk in column.foreign_keys
    )


def test_contact_columns_without_user_foreign_keys_have_reviewed_policies():
    from app.modules.account.resource_ownership import ACCOUNT_CONTACT_DATA_POLICIES

    contact_names = {
        "email",
        "new_email",
        "recipient",
        "text_body",
        "html_body",
        "terminal_actor_user_id",
    }
    actual = {
        (table.name, column.name)
        for table in SQLModel.metadata.tables.values()
        for column in table.columns
        if column.name in contact_names
    }
    declared = {
        (policy.table, name)
        for policy in ACCOUNT_CONTACT_DATA_POLICIES
        for name in policy.columns
        if name in contact_names
    }
    assert actual == declared
    assert all(
        policy.domain and policy.responsibility and policy.invalidation
        for policy in ACCOUNT_CONTACT_DATA_POLICIES
    )


def test_every_runtime_mail_admission_declares_domain_source_identity():
    import ast
    from pathlib import Path

    admissions = []
    for path in (Path(__file__).parents[1] / "app").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "queue_mail"
            ):
                keywords = {keyword.arg for keyword in node.keywords}
                assert {"source_kind", "source_id"} <= keywords, str(path)
                admissions.append((path, node.lineno))
    assert admissions
