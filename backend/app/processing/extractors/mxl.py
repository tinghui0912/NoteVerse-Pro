"""Extract XML content from compressed MXL files."""

import os
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Optional, TypedDict

from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)


class MXLExtractFailureResult(TypedDict):
    """Failure payload returned by MXL extraction helpers."""

    success: bool
    error: str


class MXLExtractSingleSuccessResult(TypedDict):
    """Successful result for extracting a single main XML file."""

    success: bool
    xml_path: str
    extracted_file: str


class MXLExtractAllSuccessResult(TypedDict):
    """Successful result for extracting all XML files from an archive."""

    success: bool
    xml_paths: list[str]
    names: list[str]
    main_xml: str | None


MXLExtractSingleResult = MXLExtractSingleSuccessResult | MXLExtractFailureResult
MXLExtractAllResult = MXLExtractAllSuccessResult | MXLExtractFailureResult


class MXLExtractor:
    """Extract one or more XML files from an MXL archive."""

    def extract_mxl_to_xml(
        self,
        mxl_path: str,
        output_dir: Optional[str] = None,
    ) -> MXLExtractSingleResult:
        """Extract the main XML file from an MXL archive."""
        try:
            if not os.path.exists(mxl_path):
                return {
                    "success": False,
                    "error": f"MXL file not found: {mxl_path}",
                }

            output_dir = output_dir or os.path.dirname(mxl_path)
            base_name = Path(mxl_path).stem
            xml_output_path = os.path.join(output_dir, f"{base_name}.xml")

            with zipfile.ZipFile(mxl_path, "r") as zip_file:
                xml_files = [
                    name
                    for name in zip_file.namelist()
                    if name.endswith(".xml") and not name.startswith("META-INF/")
                ]

                if not xml_files:
                    return {
                        "success": False,
                        "error": "No XML content found in MXL file",
                    }

                main_xml = next(
                    (name for name in xml_files if Path(name).stem == base_name),
                    xml_files[0],
                )

                logger.info(f"Starting MXL XML extraction: {main_xml}")

                with zip_file.open(main_xml) as xml_content:
                    with open(xml_output_path, "wb") as output_file:
                        output_file.write(xml_content.read())

            logger.info(f"MXL XML extraction completed: {xml_output_path}")

            return {
                "success": True,
                "xml_path": xml_output_path,
                "extracted_file": main_xml,
            }

        except zipfile.BadZipFile:
            return {
                "success": False,
                "error": "Invalid or corrupted MXL file format",
            }
        except Exception as exc:
            logger.error(f"MXL XML extraction failed: {exc}")
            return {
                "success": False,
                "error": f"MXL extraction failed: {exc}",
            }

    def extract_all_xml(
        self,
        mxl_path: str,
        output_dir: str,
    ) -> MXLExtractAllResult:
        """Extract all XML files from an MXL archive and identify the main score."""
        try:
            if not os.path.exists(mxl_path):
                return {
                    "success": False,
                    "error": f"MXL file not found: {mxl_path}",
                }

            os.makedirs(output_dir, exist_ok=True)

            with zipfile.ZipFile(mxl_path, "r") as zf:
                names = [
                    name
                    for name in zf.namelist()
                    if name.lower().endswith(".xml") and not name.startswith("META-INF/")
                ]

                if not names:
                    return {
                        "success": False,
                        "error": "No XML files found in MXL",
                    }

                extracted = []
                for name in names:
                    try:
                        extracted_path = zf.extract(name, output_dir)
                        extracted.append(os.path.abspath(extracted_path))
                    except Exception:
                        xml_bytes = zf.read(name)
                        dest = os.path.join(output_dir, os.path.basename(name))
                        with open(dest, "wb") as f:
                            f.write(xml_bytes)
                        extracted.append(os.path.abspath(dest))

                main_xml = None

                opus_candidates = [path for path in extracted if path.lower().endswith(".opus.xml")]
                if opus_candidates:
                    try:
                        tree = ET.parse(opus_candidates[0])
                        root = tree.getroot()

                        href = None
                        for score in root.findall(".//{*}score"):
                            href = (
                                score.attrib.get("{http://www.w3.org/1999/xlink}href")
                                or score.attrib.get("xlink:href")
                            )
                            if href:
                                break

                        if href:
                            base = os.path.basename(href).lower()
                            main_xml = next(
                                (
                                    path
                                    for path in extracted
                                    if os.path.basename(path).lower() == base
                                ),
                                None,
                            )
                    except Exception as exc:
                        logger.warning(f"Failed to parse opus XML metadata: {exc}")

                if not main_xml:
                    filtered = [
                        path
                        for path in extracted
                        if (
                            os.path.basename(path).lower() not in ("container.xml",)
                            and not path.lower().endswith(".opus.xml")
                        )
                    ]

                    if filtered:
                        try:
                            main_xml = max(
                                filtered,
                                key=lambda path: os.path.getsize(path) if os.path.exists(path) else 0,
                            )
                        except Exception:
                            main_xml = filtered[0]

                return {
                    "success": True,
                    "xml_paths": extracted,
                    "names": names,
                    "main_xml": main_xml,
                }

        except zipfile.BadZipFile:
            return {
                "success": False,
                "error": "Invalid or corrupted MXL file format",
            }
        except Exception as exc:
            logger.error(f"MXL full extraction failed: {exc}")
            return {
                "success": False,
                "error": str(exc),
            }

    def is_mxl_file(self, file_path: str) -> bool:
        """Return whether a file looks like a valid MXL archive."""
        if not file_path.lower().endswith(".mxl"):
            return False

        try:
            with zipfile.ZipFile(file_path, "r") as zip_file:
                xml_files = [name for name in zip_file.namelist() if name.endswith(".xml")]
                return len(xml_files) > 0
        except Exception:
            return False
