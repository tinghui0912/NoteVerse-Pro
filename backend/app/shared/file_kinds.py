"""Shared file-kind enum used across models, services, and pipeline code."""

import enum


class FileKind(str, enum.Enum):
    ORIGINAL_IMAGE = "original_image"
    MXL = "mxl"
    OMR = "omr"
    ENHANCED_XML = "enhanced_xml"
    CURRENT_XML = "current_xml"
    FINAL_XML = "final_xml"
    PREVIEW_IMAGE = "preview_image"
    FINAL_IMAGE = "final_image"

    @classmethod
    def image_kinds(cls):
        return {cls.ORIGINAL_IMAGE, cls.PREVIEW_IMAGE, cls.FINAL_IMAGE}

    @classmethod
    def xml_kinds(cls):
        return {cls.ENHANCED_XML, cls.CURRENT_XML, cls.FINAL_XML}
