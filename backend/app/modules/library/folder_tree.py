from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from app.db.model_utils import require_persisted_id
from app.db.models import ScoreLibraryFolder
from app.modules.library.schemas import LibraryFolderRead, LibraryFolderTreeRead


@dataclass(frozen=True)
class LibraryFolderCounts:
    all_count: int
    favorite_count: int
    recent_practice_count: int
    to_practice_count: int
    mastered_count: int
    direct_counts: Mapping[int, int]


def build_folder_tree_read(
    folders: list[ScoreLibraryFolder],
    counts: LibraryFolderCounts,
) -> LibraryFolderTreeRead:
    children = _folders_by_parent(folders)

    def recursive_count(folder_id: int) -> int:
        total = counts.direct_counts.get(folder_id, 0)
        for child in children.get(folder_id, []):
            child_id = require_persisted_id(child.id, entity="library folder")
            total += recursive_count(child_id)
        return total

    return LibraryFolderTreeRead(
        all_count=counts.all_count,
        favorite_count=counts.favorite_count,
        recent_practice_count=counts.recent_practice_count,
        to_practice_count=counts.to_practice_count,
        mastered_count=counts.mastered_count,
        folders=[
            LibraryFolderRead(
                folder_id=folder.folder_uuid,
                parent_folder_id=folder_uuid_by_id(folders, folder.parent_folder_id),
                name=folder.name,
                position=folder.position,
                direct_count=counts.direct_counts.get(
                    require_persisted_id(folder.id, entity="library folder"),
                    0,
                ),
                recursive_count=recursive_count(
                    require_persisted_id(folder.id, entity="library folder")
                ),
                created_at=folder.created_at,
                updated_at=folder.updated_at,
            )
            for folder in folders
        ],
    )


def folder_uuid_by_id(
    folders: list[ScoreLibraryFolder], folder_id: int | None
) -> str | None:
    if folder_id is None:
        return None
    for folder in folders:
        if folder.id == folder_id:
            return folder.folder_uuid
    return None


def descendant_folder_ids(folders: list[ScoreLibraryFolder], folder_id: int) -> set[int]:
    children = _folders_by_parent(folders)
    result: set[int] = set()

    def visit(parent_id: int) -> None:
        for child in children.get(parent_id, []):
            child_id = require_persisted_id(child.id, entity="library folder")
            result.add(child_id)
            visit(child_id)

    visit(folder_id)
    return result


def folder_level(folders: list[ScoreLibraryFolder], folder_id: int | None) -> int:
    if folder_id is None:
        return 0
    level = 1
    by_id = {
        require_persisted_id(folder.id, entity="library folder"): folder
        for folder in folders
    }
    current = by_id.get(folder_id)
    seen = {folder_id}
    while current and current.parent_folder_id is not None:
        parent_id = current.parent_folder_id
        if parent_id in seen:
            break
        seen.add(parent_id)
        level += 1
        current = by_id.get(parent_id)
    return level


def subtree_height(folders: list[ScoreLibraryFolder], folder_id: int) -> int:
    children = _folders_by_parent(folders)

    def visit(parent_id: int) -> int:
        child_heights = [
            visit(require_persisted_id(child.id, entity="library folder"))
            for child in children.get(parent_id, [])
        ]
        return 1 + (max(child_heights) if child_heights else 0)

    return visit(folder_id)


def _folders_by_parent(
    folders: list[ScoreLibraryFolder],
) -> dict[int | None, list[ScoreLibraryFolder]]:
    children: dict[int | None, list[ScoreLibraryFolder]] = {}
    for folder in folders:
        children.setdefault(folder.parent_folder_id, []).append(folder)
    return children
