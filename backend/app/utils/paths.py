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


def build_task_dirs(temp_root: str, task_id: str) -> Dict[str, str]:
    """Build and create the standard directory set for a task workspace."""

    base = abs_path(os.path.join(temp_root, task_id))
    subdirs = ["raw", "pdf", "audiveris", "xml", "preview"]
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
        "uploads": os.path.abspath(settings.UPLOAD_FOLDER),
        "output": os.path.abspath(settings.OUTPUT_FOLDER),
        "temp": os.path.abspath(settings.TEMP_FOLDER),
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

    # Fall back to the legacy project-relative form when no storage root matches.
    return to_rel(p)


def resolve_stored_path(path: str) -> str:
    """Resolve a stored path string to an absolute filesystem path."""

    if not path:
        return path

    if os.path.isabs(path):
        return path

    norm = path.replace("\\", "/")
    prefix, _, rest = norm.partition("/")

    if prefix in ("uploads", "output", "temp"):
        roots = _storage_roots()
        base = roots[prefix]
        return os.path.abspath(os.path.join(base, rest))

    # Fall back to the legacy project-relative form.
    return os.path.abspath(os.path.join(project_root(), path))
