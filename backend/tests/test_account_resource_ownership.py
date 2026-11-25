"""Every actual ownership edge has a deliberate reviewed erasure policy."""

from sqlmodel import SQLModel
from app.db import models  # noqa: F401
from app.modules.account.resource_ownership import ACCOUNT_RESOURCE_POLICIES
from app.modules.storage_objects.references import SEMANTIC_REFERENCES


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
