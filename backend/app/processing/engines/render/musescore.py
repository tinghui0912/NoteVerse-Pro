"""MuseScore adapter for the score rendering abstraction."""

from __future__ import annotations

import glob
import os

from app.core.config import settings
from app.shared.constants import ErrorCode

from .base import ScoreRenderOutputFile, ScoreRenderResult

MIME_BY_FORMAT = {
    "png": "image/png",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}


class MuseScoreRenderEngine:
    """Render MusicXML with the existing MuseScore CLI engine."""

    engine_name = "musescore"

    def __init__(
        self,
        *,
        output_folder: str,
        musescore_path: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        self.output_folder = output_folder
        self.musescore_path = musescore_path or settings.MUSESCORE_PATH
        self.timeout_seconds = timeout_seconds

    def render_score(
        self,
        *,
        xml_path: str,
        output_name: str,
        output_format: str = "png",
    ) -> ScoreRenderResult:
        """Render a score and normalize MuseScore's result shape."""

        from app.processing.engines.musescore import MuseScoreEngine

        if not self.musescore_path or not os.path.exists(self.musescore_path):
            return {
                "success": False,
                "engine": self.engine_name,
                "code": ErrorCode.MUSESCORE_MISSING,
                "error": "MuseScore executable is not configured or does not exist",
            }

        engine = MuseScoreEngine(
            musescore_path=self.musescore_path,
            output_folder=self.output_folder,
            timeout_seconds=self.timeout_seconds,
        )
        result = engine.render_to_image(
            xml_path=xml_path,
            output_name=output_name,
            format=output_format,
        )

        if not result.get("success"):
            return {
                "success": False,
                "engine": self.engine_name,
                "code": str(result.get("code") or ErrorCode.MUSESCORE_FAILED),
                "error": str(result.get("error") or "MuseScore rendering failed"),
            }

        files = self._collect_outputs(output_name=output_name, output_format=output_format)
        if not files:
            return {
                "success": False,
                "engine": self.engine_name,
                "code": ErrorCode.MUSESCORE_FAILED,
                "error": "MuseScore completed but no rendered files were found",
            }

        return {
            "success": True,
            "engine": self.engine_name,
            "files": files,
            "stdout": "",
            "stderr": "",
        }

    def _collect_outputs(
        self,
        *,
        output_name: str,
        output_format: str,
    ) -> list[ScoreRenderOutputFile]:
        """Collect single-file and page-numbered MuseScore outputs."""

        output_dir = os.path.abspath(self.output_folder)
        single = os.path.join(output_dir, f"{output_name}.{output_format}")
        numbered = sorted(glob.glob(os.path.join(output_dir, f"{output_name}-*.{output_format}")))
        paths = numbered or ([single] if os.path.exists(single) else [])
        mime_type = MIME_BY_FORMAT.get(output_format, "application/octet-stream")

        return [
            {
                "path": os.path.abspath(path),
                "page": index,
                "format": output_format,
                "mime_type": mime_type,
            }
            for index, path in enumerate(paths, 1)
        ]
