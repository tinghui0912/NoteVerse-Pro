from app.processing.engines.render.verovio_render_profile import (
    DEFAULT_VEROVIO_RENDER_PROFILE,
)


def test_default_verovio_render_profile_has_stable_svg_options() -> None:
    profile = DEFAULT_VEROVIO_RENDER_PROFILE

    assert profile.identity() == {
        "schema_version": 1,
        "engine": "verovio",
        "page_width": 2100,
        "page_height": 2970,
        "scale": 40,
        "breaks": "encoded",
        "adjust_page_height": False,
        "justify_vertically": True,
        "page_margin_top": 390,
        "page_margin_bottom": 80,
        "header": "none",
        "footer": "always",
        "use_page_footer_for_all": True,
        "preview_header_postprocessing": True,
    }
    assert profile.renderer_options() == {
        "inputFrom": "xml",
        "pageWidth": 2100,
        "pageHeight": 2970,
        "scale": 40,
        "adjustPageHeight": False,
        "justifyVertically": True,
        "pageMarginTop": 390,
        "pageMarginBottom": 80,
        "breaks": "encoded",
        "header": "none",
        "footer": "always",
        "usePgFooterForAll": True,
    }
