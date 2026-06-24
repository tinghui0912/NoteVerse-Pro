from __future__ import annotations

from enum import Enum


class MyScoresView(str, Enum):
    ALL = "all"
    DRAFTS = "drafts"
    PRIVATE = "private"
    PUBLISHED = "published"


class MyScoresSort(str, Enum):
    UPDATED_DESC = "updated_desc"
    UPDATED_ASC = "updated_asc"
    NAME_ASC = "name_asc"
    NAME_DESC = "name_desc"
