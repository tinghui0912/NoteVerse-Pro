"""Helpers for materializing storage keys to local working paths."""

from __future__ import annotations


from pathlib import Path


def object_work_path(key: str, *, work_root: str) -> str:
    root = Path(work_root).resolve() / "object-cache"
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Invalid object key")
    return str(path)
