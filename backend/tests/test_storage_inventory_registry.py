"""Inventory registration is exhaustive, strict, additive and immutable."""

from collections.abc import Mapping
from dataclasses import FrozenInstanceError, dataclass
from typing import cast

import pytest
from sqlalchemy.orm import Session

from app.modules.storage_governance.usage.domain import StorageUsageCategory as Category
from app.modules.storage_governance.inventory.contracts import StorageInventorySnapshot
from app.modules.storage_governance.inventory.registry import StorageInventoryRegistry


@dataclass(frozen=True)
class InventoryProvider:
    categories: frozenset[Category]
    totals: Mapping[Category, int]

    def used_bytes_for_user(self, db: Session, user_id: int) -> Mapping[Category, int]:
        return self.totals


def complete_providers():
    return [InventoryProvider(frozenset({category}), {category: 0}) for category in Category]


def test_complete_registry_returns_all_categories_and_adds_shared_category_contributions():
    providers = complete_providers()
    providers.extend(
        [
            InventoryProvider(frozenset({Category.UPLOAD}), {Category.UPLOAD: 23}),
            InventoryProvider(frozenset({Category.UPLOAD}), {Category.UPLOAD: 31}),
        ]
    )
    with Session() as db:
        snapshot = StorageInventoryRegistry(providers).snapshot_user(db, 7)
    assert snapshot.user_id == 7
    assert snapshot.used_bytes == {c: 54 if c is Category.UPLOAD else 0 for c in Category}


@pytest.mark.parametrize("missing", list(Category))
def test_missing_category_provider_fails_at_composition(missing):
    providers = [p for p in complete_providers() if missing not in p.categories]
    with pytest.raises(ValueError, match="Missing storage inventory providers"):
        StorageInventoryRegistry(providers)


@pytest.mark.parametrize("categories", [frozenset(), frozenset({"UNKNOWN"}), frozenset({"UPLOAD"})])
def test_provider_declarations_require_actual_categories(categories):
    with pytest.raises(ValueError, match="declare valid storage categories"):
        StorageInventoryRegistry([*complete_providers(), InventoryProvider(categories, {})])


@pytest.mark.parametrize(
    "returned",
    [
        {},
        {Category.SOURCE: 1},
        {Category.UPLOAD: 1, Category.SOURCE: 2},
        {"UNKNOWN": 0},
        {"UPLOAD": 0},
    ],
)
def test_provider_result_must_match_declared_categories(returned):
    provider = InventoryProvider(frozenset({Category.UPLOAD}), returned)
    registry = StorageInventoryRegistry([*complete_providers(), provider])
    with Session() as db, pytest.raises(ValueError, match="exactly its declared categories"):
        registry.snapshot_user(db, 1)


@pytest.mark.parametrize("amount", [-1, True, 1.5, "4"])
def test_provider_result_rejects_negative_or_noninteger_bytes(amount):
    provider = InventoryProvider(frozenset({Category.UPLOAD}), {Category.UPLOAD: amount})
    registry = StorageInventoryRegistry([*complete_providers(), provider])
    with Session() as db, pytest.raises(ValueError, match="nonnegative integers"):
        registry.snapshot_user(db, 1)


def test_invalid_category_is_not_silently_covered_by_an_enum_value_string():
    with pytest.raises(ValueError, match="declare valid"):
        StorageInventoryRegistry([InventoryProvider(frozenset({cast(Category, "SOURCE")}), {})])


def test_snapshot_copies_input_and_does_not_allow_mutation():
    values = dict.fromkeys(Category, 0)
    snapshot = StorageInventorySnapshot(1, values)
    values[Category.UPLOAD] = 42
    assert snapshot.used_bytes[Category.UPLOAD] == 0
    with pytest.raises(TypeError):
        snapshot.used_bytes[Category.UPLOAD] = 1
    with pytest.raises(FrozenInstanceError):
        snapshot.user_id = 2


def test_provider_query_failure_propagates():
    class FailedProvider:
        categories = frozenset(Category)

        def used_bytes_for_user(self, db: Session, user_id: int) -> Mapping[Category, int]:
            raise RuntimeError("inventory query unavailable")

    with Session() as db, pytest.raises(RuntimeError, match="inventory query unavailable"):
        StorageInventoryRegistry([FailedProvider()]).snapshot_user(db, 1)
