"""Resolved provenance identity for rendered score assets."""

from app.processing.engines.render.verovio_render_profile import DEFAULT_VEROVIO_RENDER_PROFILE


def build_render_execution_manifest() -> dict[str, object]:
    """Return the immutable algorithm profile that controls SVG output."""

    profile = DEFAULT_VEROVIO_RENDER_PROFILE
    return {
        "schema_version": 1,
        "kind": "render",
        "engine": profile.engine,
        "profile": profile.identity(),
    }
