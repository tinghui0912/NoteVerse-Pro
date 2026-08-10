"""Verovio score rendering engine."""

from __future__ import annotations

import os

from app.shared.constants import ErrorCode

from .base import ScoreRenderOutputFile, ScoreRenderResult
from .svg_preview_postprocessor import SvgPreviewPostProcessor
from .verovio_render_profile import DEFAULT_VEROVIO_RENDER_PROFILE


class VerovioRenderEngine:
    """Render MusicXML into SVG pages using Verovio."""

    engine_name = "verovio"
    default_output_format = "svg"

    def __init__(self, *, output_folder: str, timeout_seconds: int | None = None) -> None:
        self.output_folder = output_folder
        self.timeout_seconds = timeout_seconds
        self.svg_postprocessor = SvgPreviewPostProcessor(
            enabled=DEFAULT_VEROVIO_RENDER_PROFILE.preview_header_postprocessing
        )

    def render_score(
        self,
        *,
        xml_path: str,
        output_name: str,
        output_format: str | None = None,
    ) -> ScoreRenderResult:
        """Render a MusicXML score to SVG pages."""

        selected_format = output_format or self.default_output_format
        if selected_format != "svg":
            return {
                "success": False,
                "engine": self.engine_name,
                "code": ErrorCode.SCORE_PREVIEW_FAILED,
                "error": "Verovio renderer supports SVG output only",
            }

        if not os.path.exists(xml_path):
            return {
                "success": False,
                "engine": self.engine_name,
                "code": ErrorCode.XML_NOT_FOUND,
                "error": f"MusicXML file not found: {xml_path}",
            }

        try:
            import verovio
        except Exception as exc:
            return {
                "success": False,
                "engine": self.engine_name,
                "code": ErrorCode.SCORE_PREVIEW_FAILED,
                "error": str(exc),
            }

        try:
            os.makedirs(self.output_folder, exist_ok=True)
            toolkit = verovio.toolkit()
            toolkit.setOptions(self._options())
            loaded = toolkit.loadFile(os.path.abspath(xml_path))
            if loaded is False:
                return {
                    "success": False,
                    "engine": self.engine_name,
                    "code": ErrorCode.SCORE_PREVIEW_FAILED,
                    "error": "Verovio failed to load MusicXML",
                }

            page_count = int(toolkit.getPageCount())
            if page_count <= 0:
                return {
                    "success": False,
                    "engine": self.engine_name,
                    "code": ErrorCode.SCORE_PREVIEW_FAILED,
                    "error": "Verovio produced no pages",
                }

            files: list[ScoreRenderOutputFile] = []
            for page in range(1, page_count + 1):
                svg = self._add_white_background(toolkit.renderToSVG(page))
                svg = self.svg_postprocessor.process(
                    svg=svg,
                    xml_path=xml_path,
                    page_number=page,
                )
                path = os.path.abspath(
                    os.path.join(self.output_folder, f"{output_name}-{page:02d}.svg")
                )
                with open(path, "w", encoding="utf-8") as file_handle:
                    file_handle.write(svg)
                files.append(
                    {
                        "path": path,
                        "page": page,
                        "format": "svg",
                        "mime_type": "image/svg+xml",
                    }
                )

            return {
                "success": True,
                "engine": self.engine_name,
                "files": files,
                "stdout": "",
                "stderr": "",
            }
        except Exception as exc:
            return {
                "success": False,
                "engine": self.engine_name,
                "code": ErrorCode.SCORE_PREVIEW_FAILED,
                "error": str(exc),
            }

    def _options(self) -> dict[str, object]:
        """Build Verovio options from the versioned rendering profile."""

        return DEFAULT_VEROVIO_RENDER_PROFILE.renderer_options()

    @staticmethod
    def _add_white_background(svg: str) -> str:
        """Make Verovio SVG pages look like white score paper in any container."""

        if "<rect data-nv-background" in svg:
            return svg

        svg_start = svg.find("<svg")
        if svg_start < 0:
            return svg

        svg_open_end = svg.find(">", svg_start)
        if svg_open_end < 0:
            return svg

        background = '<rect data-nv-background="true" width="100%" height="100%" fill="white"/>'
        return f"{svg[: svg_open_end + 1]}{background}{svg[svg_open_end + 1 :]}"
