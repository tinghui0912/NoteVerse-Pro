"""Shared file-kind enum used across models, services, and pipeline code."""

import enum


class FileKind(str, enum.Enum):
    ORIGINAL_IMAGE = "original_image"
    MXL = "mxl"
    OMR = "omr"
    ENHANCED_XML = "enhanced_xml"
    NORMALIZED_MUSICXML = "normalized_musicxml"
    REVIEW_MUSICXML = "review_musicxml"
    PREVIEW_IMAGE = "preview_image"
    RESULT_THUMBNAIL = "result_thumbnail"
    FINAL_IMAGE = "final_image"

    @classmethod
    def image_kinds(cls):
        return {cls.ORIGINAL_IMAGE, cls.PREVIEW_IMAGE, cls.RESULT_THUMBNAIL, cls.FINAL_IMAGE}

    @classmethod
    def xml_kinds(cls):
        return {cls.ENHANCED_XML, cls.NORMALIZED_MUSICXML, cls.REVIEW_MUSICXML}
