from __future__ import annotations

import tempfile
from pathlib import Path

from app.processing.engines.render.svg_preview_postprocessor import (
    SvgPreviewPostProcessor,
)


def test_svg_preview_postprocessor_replaces_verovio_header_without_changing_xml() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xml_path = Path(temp_dir) / "score.musicxml"
        original_xml = """<?xml version="1.0" encoding="utf-8"?>
<score-partwise>
  <work><work-title>Once Again</work-title></work>
  <identification>
    <creator type="composer">钢琴编曲：MayPiano</creator>
    <creator type="lyricist">原唱：金娜英</creator>
  </identification>
  <credit page="1">
    <credit-type>subtitle</credit-type>
    <credit-words>再次见到你</credit-words>
  </credit>
  <part-list />
</score-partwise>
"""
        xml_path.write_text(original_xml, encoding="utf-8")
        svg = """<svg width="840px" height="1188px" xmlns="http://www.w3.org/2000/svg">
  <svg class="definition-scale" viewBox="0 0 21000 29700">
    <g class="pgHead"><text>Verovio title</text></g>
    <g class="system"><text>music</text></g>
  </svg>
</svg>"""

        processed = SvgPreviewPostProcessor().process(
            svg=svg,
            xml_path=str(xml_path),
            page_number=1,
        )

        assert xml_path.read_text(encoding="utf-8") == original_xml
        assert "Verovio title" not in processed
        assert 'data-nv-score-header="true"' in processed
        assert "Once Again" in processed
        assert "再次见到你" in processed
        assert "钢琴编曲：MayPiano" in processed
        assert "原唱：金娜英" in processed
        assert 'y="1600"' in processed
        assert 'y="2080"' in processed
        assert 'x="19500" y="2750" text-anchor="end"' in processed
        assert 'x="19500" y="3150" text-anchor="end"' in processed
        assert 'y="2750"' in processed
        assert 'y="3150"' in processed
        assert '<g class="system">' in processed


def test_svg_preview_postprocessor_only_adds_header_to_first_page() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xml_path = Path(temp_dir) / "score.musicxml"
        xml_path.write_text(
            "<score-partwise><work><work-title>Title</work-title></work></score-partwise>",
            encoding="utf-8",
        )
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><svg class="definition-scale" /></svg>'

        processed = SvgPreviewPostProcessor().process(
            svg=svg,
            xml_path=str(xml_path),
            page_number=2,
        )

        assert processed == svg
