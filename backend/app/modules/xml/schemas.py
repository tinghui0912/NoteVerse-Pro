"""
XML request schemas for the xml module.
"""
from __future__ import annotations

from typing import Literal, Optional, TypedDict

from pydantic import BaseModel, Field


class XMLLoadParams(BaseModel):
    source: Literal["final", "current"] = Field(
        description="XML source type",
    )
    share_token: Optional[str] = Field(
        default=None,
        description="Optional share token",
    )


class XMLSaveRequest(BaseModel):
    content: str = Field(..., min_length=1, description="XML content")
    file_type: Literal["current_xml", "final_xml"] = Field(
        default="current_xml",
        description="Target XML file type",
    )
    image_type: Optional[Literal["preview_image", "final_image"]] = Field(
        default=None,
        description="Optional image type to rerender after save",
    )


class FingeringRequest(BaseModel):
    hand: Literal["left", "right", "both"] = Field(
        default="both",
        description="Which hand to generate fingering for",
    )
    depth: int = Field(
        default=6,
        ge=1,
        le=10,
        description="Search depth from 1 to 10",
    )


class XMLLoadResult(TypedDict):
    content: str
    file_type: str
    last_modified: str


class XMLSaveResult(TypedDict, total=False):
    storage_key: str
    size_bytes: int
    image_count: int


class XMLImageItem(TypedDict):
    storage_key: str
    page: int


class XMLConfirmResult(TypedDict):
    task_id: str
    final_xml: str
    final_images: list[XMLImageItem]
    image_count: int


class XMLFingeringResult(TypedDict):
    xml_content: str
    hand: str
    depth: int
