"""Helpers for working with persisted ORM model instances."""


def require_persisted_id(value: int | None, *, entity: str) -> int:
    """Return a non-null primary key for a persisted entity.

    SQLModel instances expose primary keys as ``int | None`` because they may be
    constructed before a database flush. Downstream service and repository code
    often only accepts persisted entities, so this helper narrows the type and
    raises a clear error if that assumption is violated.
    """

    if value is None:
        raise ValueError(f"{entity} does not have a persisted id")
    return value
