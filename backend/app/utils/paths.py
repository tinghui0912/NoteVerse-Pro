"""Path utilities for project-relative and storage-relative file handling."""

import os
from pathlib import Path
from typing import Dict


def project_root() -> str:
    """Return the absolute backend project root path."""

    return str(Path(__file__).parent.parent.parent)


def abs_path(p: str) -> str:
    """Convert a path to an absolute path."""

    if not p:
        return p
    return os.path.abspath(p)


def to_rel(p: str) -> str:
    """Convert an absolute path to a project-root-relative path."""

    try:
        rel = os.path.relpath(p, project_root())
        return rel.replace("\\", "/")
    except Exception:
        return p


def build_task_dirs(work_root: str, task_id: str) -> Dict[str, str]:
    """Build and create the standard directory set for a task workspace."""

    base = abs_path(os.path.join(work_root, task_id))
    subdirs = ["raw", "pdf", "omr", "xml", "preview"]
    paths = {name: os.path.join(base, name) for name in subdirs}

    os.makedirs(base, exist_ok=True)
    for path in paths.values():
        os.makedirs(path, exist_ok=True)

    return paths


def _storage_roots() -> Dict[str, str]:
    """Return the configured storage root directories.

    This helper imports settings lazily to avoid circular imports.
    """

    from app.core.config import settings

    return {
        "storage": os.path.abspath(settings.STORAGE_ROOT),
        "work": os.path.abspath(settings.WORK_ROOT),
    }


def to_rel_storage(abs_p: str) -> str:
    """Convert an absolute path to a storage-root-relative path."""

    p = os.path.abspath(abs_p) if abs_p else abs_p
    if not p:
        return p

    roots = _storage_roots()
    for alias, root in roots.items():
        root_s = root.rstrip(os.sep) + os.sep
        p_s = p.rstrip(os.sep) + os.sep

        if p_s.startswith(root_s):
            rel = os.path.relpath(p, root)
            return os.path.join(alias, rel).replace("\\", "/")

        if p == root:
            return alias

    # Non-runtime paths remain project-relative for diagnostic output.
    return to_rel(p)


def resolve_stored_path(path: str) -> str:
    """Resolve a stored path string to an absolute filesystem path."""

    if not path:
        return path

    if os.path.isabs(path):
        return path

    norm = path.replace("\\", "/")
    prefix, _, rest = norm.partition("/")

    if prefix in ("storage", "work"):
        roots = _storage_roots()
        base = roots[prefix]
        return os.path.abspath(os.path.join(base, rest))

    # Non-runtime paths are resolved relative to the backend project root.
    return os.path.abspath(os.path.join(project_root(), path))
