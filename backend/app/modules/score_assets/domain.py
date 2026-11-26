"""Domain-owned resource states."""

import enum


class RenderAssetKind(str, enum.Enum):
    RENDERED_PAGE = "RENDERED_PAGE"
