from __future__ import annotations

from datetime import datetime

from app.db.models import ScoreLibraryFolder
from app.modules.library.folder_tree import (
    LibraryFolderCounts,
    build_folder_tree_read,
    descendant_folder_ids,
    folder_level,
    folder_uuid_by_id,
    subtree_height,
)


def _folder(
    folder_id: int,
    *,
    uuid: str,
    parent_id: int | None = None,
    name: str | None = None,
    position: int = 0,
) -> ScoreLibraryFolder:
    timestamp = datetime(2026, 8, 11, 8, 0, 0)
    return ScoreLibraryFolder(
        id=folder_id,
        folder_uuid=uuid,
        user_id=7,
        parent_folder_id=parent_id,
        name=name or uuid,
        position=position,
        created_at=timestamp,
        updated_at=timestamp,
    )


def test_folder_tree_projects_parent_uuid_and_recursive_counts() -> None:
    folders = [
        _folder(1, uuid="root", name="Root"),
        _folder(2, uuid="child", parent_id=1, name="Child"),
        _folder(3, uuid="leaf", parent_id=2, name="Leaf"),
    ]

    tree = build_folder_tree_read(
        folders,
        LibraryFolderCounts(
            all_count=6,
            favorite_count=2,
            recent_practice_count=1,
            to_practice_count=4,
            mastered_count=3,
            direct_counts={1: 2, 2: 3, 3: 1},
        ),
    )

    assert tree.all_count == 6
    assert [folder.folder_id for folder in tree.folders] == ["root", "child", "leaf"]
    assert tree.folders[0].parent_folder_id is None
    assert tree.folders[0].direct_count == 2
    assert tree.folders[0].recursive_count == 6
    assert tree.folders[1].parent_folder_id == "root"
    assert tree.folders[1].recursive_count == 4
    assert tree.folders[2].parent_folder_id == "child"
    assert tree.folders[2].recursive_count == 1


def test_folder_tree_rules_describe_hierarchy_for_move_validation() -> None:
    folders = [
        _folder(1, uuid="root"),
        _folder(2, uuid="child-a", parent_id=1),
        _folder(3, uuid="child-b", parent_id=1),
        _folder(4, uuid="leaf", parent_id=2),
    ]

    assert folder_uuid_by_id(folders, 3) == "child-b"
    assert folder_uuid_by_id(folders, 99) is None
    assert descendant_folder_ids(folders, 1) == {2, 3, 4}
    assert descendant_folder_ids(folders, 2) == {4}
    assert folder_level(folders, None) == 0
    assert folder_level(folders, 1) == 1
    assert folder_level(folders, 4) == 3
    assert subtree_height(folders, 1) == 3
    assert subtree_height(folders, 3) == 1
