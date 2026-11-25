"""Typed invariant failure requiring repair before durable work can resume."""


class ResourceIntegrityError(RuntimeError):
    """Persisted resource facts disagree; automatic retry cannot repair ownership."""
