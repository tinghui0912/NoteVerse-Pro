from __future__ import annotations

import os
import tempfile
import zipfile

from app.processing.extractors.mxl import MXLExtractor


def test_extract_mxl_to_xml_returns_error_for_missing_file() -> None:
    extractor = MXLExtractor()
    result = extractor.extract_mxl_to_xml("C:/missing/file.mxl")

    assert result["success"] is False
    assert "MXL file not found" in result["error"]


def test_extract_mxl_to_xml_rejects_invalid_zip() -> None:
    extractor = MXLExtractor()

    with tempfile.TemporaryDirectory() as temp_dir:
        mxl_path = os.path.join(temp_dir, "broken.mxl")
        with open(mxl_path, "wb") as file_handle:
            file_handle.write(b"not-a-zip")

        result = extractor.extract_mxl_to_xml(mxl_path)

    assert result["success"] is False
    assert result["error"] == "Invalid or corrupted MXL file format"


def test_extract_mxl_to_xml_extracts_named_score_xml() -> None:
    extractor = MXLExtractor()

    with tempfile.TemporaryDirectory() as temp_dir:
        mxl_path = os.path.join(temp_dir, "score.mxl")
        with zipfile.ZipFile(mxl_path, "w") as archive:
            archive.writestr("META-INF/container.xml", "<container/>")
            archive.writestr("score.xml", "<score-partwise />")
            archive.writestr("other.xml", "<score-partwise />")

        result = extractor.extract_mxl_to_xml(mxl_path)

        assert result["success"] is True
        assert os.path.exists(result["xml_path"])
        assert result["extracted_file"] == "score.xml"


def test_extract_all_xml_picks_largest_non_opus_xml_when_no_metadata() -> None:
    extractor = MXLExtractor()

    with tempfile.TemporaryDirectory() as temp_dir:
        mxl_path = os.path.join(temp_dir, "bundle.mxl")
        output_dir = os.path.join(temp_dir, "out")

        with zipfile.ZipFile(mxl_path, "w") as archive:
            archive.writestr("small.xml", "<score-partwise />")
            archive.writestr("large.xml", "<score-partwise>" + ("a" * 200) + "</score-partwise>")

        result = extractor.extract_all_xml(mxl_path, output_dir)

        assert result["success"] is True
        assert result["main_xml"].endswith("large.xml")
        assert len(result["xml_paths"]) == 2


def test_extract_all_xml_uses_opus_metadata_when_available() -> None:
    extractor = MXLExtractor()
    opus_xml = """<?xml version="1.0" encoding="UTF-8"?>
<opus xmlns:xlink="http://www.w3.org/1999/xlink">
  <score xlink:href="main-score.xml" />
</opus>
"""
    with tempfile.TemporaryDirectory() as temp_dir:
        mxl_path = os.path.join(temp_dir, "opus_bundle.mxl")
        output_dir = os.path.join(temp_dir, "out")

        with zipfile.ZipFile(mxl_path, "w") as archive:
            archive.writestr("collection.opus.xml", opus_xml)
            archive.writestr("main-score.xml", "<score-partwise><main/></score-partwise>")
            archive.writestr("secondary.xml", "<score-partwise><secondary/></score-partwise>")

        result = extractor.extract_all_xml(mxl_path, output_dir)

        assert result["success"] is True
        assert result["main_xml"] is not None
        assert result["main_xml"].endswith("main-score.xml")
