from __future__ import annotations

import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from app.processing.text.integration import TextIntegrationEngine


def test_musicxml_input_writes_separate_enhanced_file() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xml_path = Path(temp_dir) / "prediction.musicxml"
        xml_path.write_text(
            "<score-partwise><part-list /></score-partwise>",
            encoding="utf-8",
        )

        result = TextIntegrationEngine().integrate_text_with_existing_info(
            str(xml_path),
            {
                "title": "Once Again",
                "subtitle": None,
                "composer": None,
                "lyricist": None,
                "copyright": None,
                "other_texts": [],
            },
        )

        assert result["success"] is True
        output_file = Path(result["output_file"])
        assert output_file.name == "prediction_enhanced.musicxml"
        assert output_file != xml_path

        original_root = ET.parse(xml_path).getroot()
        enhanced_root = ET.parse(output_file).getroot()
        assert original_root.find("work") is None
        assert enhanced_root.findtext("work/work-title") == "Once Again"


def test_copyright_credit_uses_one_credit_word_per_line() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xml_path = Path(temp_dir) / "score.musicxml"
        xml_path.write_text(
            "<score-partwise><part-list /></score-partwise>",
            encoding="utf-8",
        )

        result = TextIntegrationEngine().integrate_text_with_existing_info(
            str(xml_path),
            {
                "title": None,
                "subtitle": None,
                "composer": None,
                "lyricist": None,
                "copyright": "MayPiano版权所有©\n未经允许请勿转载，侵权必究",
                "other_texts": [],
            },
        )

        assert result["success"] is True
        root = ET.parse(result["output_file"]).getroot()
        rights_credit = next(
            credit
            for credit in root.findall("credit")
            if credit.findtext("credit-type") == "rights"
        )
        credit_words = rights_credit.findall("credit-words")

        assert [item.text for item in credit_words] == [
            "MayPiano版权所有©",
            "未经允许请勿转载，侵权必究",
        ]
        assert float(credit_words[0].get("default-y", "0")) > float(
            credit_words[1].get("default-y", "0")
        )


def test_creator_credits_are_right_aligned_with_lyricist_above_composer() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xml_path = Path(temp_dir) / "score.musicxml"
        xml_path.write_text(
            "<score-partwise><part-list /></score-partwise>",
            encoding="utf-8",
        )

        result = TextIntegrationEngine().integrate_text_with_existing_info(
            str(xml_path),
            {
                "title": None,
                "subtitle": None,
                "composer": "Arranged by MayPiano",
                "lyricist": "Original artist",
                "copyright": None,
                "other_texts": [],
            },
        )

        assert result["success"] is True
        root = ET.parse(result["output_file"]).getroot()
        credits = {
            credit.findtext("credit-type"): credit.find("credit-words")
            for credit in root.findall("credit")
        }
        composer = credits["composer"]
        lyricist = credits["lyricist"]

        assert composer is not None
        assert lyricist is not None
        assert composer.get("default-x") == lyricist.get("default-x")
        assert composer.get("justify") == "right"
        assert lyricist.get("justify") == "right"
        assert float(lyricist.get("default-y", "0")) > float(
            composer.get("default-y", "0")
        )
