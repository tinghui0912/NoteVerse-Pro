"""Versioned output profile for the supported Verovio score renderer.

Rendering values live with the engine because changing any of them can alter a
generated SVG artifact. They are therefore reviewed and regression-tested as a
single versioned profile, rather than being deployment environment variables.
"""

from dataclasses import asdict, dataclass
from typing import Any, Final


@dataclass(frozen=True)
class VerovioRenderProfile:
    """Immutable options defining the standard NoteVerse SVG score output."""

    schema_version: int = 1
    engine: str = "verovio"
    page_width: int = 2100
    page_height: int = 2970
    scale: int = 40
    breaks: str = "encoded"
    adjust_page_height: bool = False
    justify_vertically: bool = True
    page_margin_top: int = 390
    page_margin_bottom: int = 80
    header: str = "none"
    footer: str = "always"
    use_page_footer_for_all: bool = True
    preview_header_postprocessing: bool = True

    def renderer_options(self) -> dict[str, Any]:
        """Return the Verovio toolkit options for this immutable profile."""

        return {
            "inputFrom": "xml",
            "pageWidth": self.page_width,
            "pageHeight": self.page_height,
            "scale": self.scale,
            "adjustPageHeight": self.adjust_page_height,
            "justifyVertically": self.justify_vertically,
            "pageMarginTop": self.page_margin_top,
            "pageMarginBottom": self.page_margin_bottom,
            "breaks": self.breaks,
            "header": self.header,
            "footer": self.footer,
            "usePgFooterForAll": self.use_page_footer_for_all,
        }

    def identity(self) -> dict[str, object]:
        """Return the profile contents for future artifact provenance records."""

        return asdict(self)


DEFAULT_VEROVIO_RENDER_PROFILE: Final[VerovioRenderProfile] = VerovioRenderProfile()
