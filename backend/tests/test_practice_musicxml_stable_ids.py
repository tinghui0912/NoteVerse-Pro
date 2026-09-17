from __future__ import annotations

import xml.etree.ElementTree as ET

from app.processing.engines.practice_alignment.musicxml_stable_ids import (
    prepare_musicxml_ids_for_practice,
)


def test_prepare_musicxml_ids_for_practice_preserves_existing_ids() -> None:
    source = """
<score-partwise>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note id="legacy"><pitch><step>C</step><octave>4</octave></pitch></note>
    </measure>
  </part>
</score-partwise>
"""

    prepared = prepare_musicxml_ids_for_practice(source)

    note = ET.fromstring(prepared).find(".//note")
    assert note is not None
    assert note.get("id") == "legacy"


def test_prepare_musicxml_ids_for_practice_adds_structural_ids() -> None:
    source = """
<score-partwise>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch></note>
      <note><pitch><step>D</step><octave>4</octave></pitch></note>
      <forward />
    </measure>
  </part>
</score-partwise>
"""

    prepared = prepare_musicxml_ids_for_practice(source)
    root = ET.fromstring(prepared)

    notes = root.findall(".//note")
    forward = root.find(".//forward")

    assert [note.get("id") for note in notes] == [
        "nv-p1-m1-note1",
        "nv-p1-m1-note2",
    ]
    assert forward is not None
    assert forward.get("id") == "nv-p1-m1-forward3"


def test_prepare_musicxml_ids_for_practice_sanitizes_duplicates() -> None:
    source = """
<score-partwise>
  <part id="P1">
    <measure number="1">
      <note id="1 bad id" />
      <note id="nv-1-bad-id" />
      <note id="nv-1-bad-id" />
    </measure>
  </part>
</score-partwise>
"""

    prepared = prepare_musicxml_ids_for_practice(source)
    notes = ET.fromstring(prepared).findall(".//note")

    assert [note.get("id") for note in notes] == [
        "nv-1-bad-id",
        "nv-1-bad-id-2",
        "nv-1-bad-id-3",
    ]


def test_prepare_musicxml_ids_for_practice_avoids_preserved_generated_collisions() -> None:
    source = """
<score-partwise>
  <part id="P1">
    <measure number="1">
      <note id="nv-p1-m1-note2" />
      <note />
    </measure>
  </part>
</score-partwise>
"""

    prepared = prepare_musicxml_ids_for_practice(source)
    notes = ET.fromstring(prepared).findall(".//note")

    assert [note.get("id") for note in notes] == [
        "nv-p1-m1-note2",
        "nv-p1-m1-note2-2",
    ]
