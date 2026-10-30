from __future__ import annotations

import xml.etree.ElementTree as ET

from app.processing.practice_score.musicxml_stable_ids import (
    prepare_musicxml_ids_for_practice,
)
from app.processing.practice_score.score_loader import practice_score_timeline_from_prepared_musicxml


def test_practice_ready_musicxml_ids_match_artifact_timeline_render_ids(tmp_path) -> None:
    source = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="A">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><rest/><duration>1</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="B">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
"""
    score_path = tmp_path / "score.musicxml"
    prepared = prepare_musicxml_ids_for_practice(source)
    score_path.write_text(prepared, encoding="utf-8")
    prepared_note_ids = [
        note.get("id")
        for note in ET.fromstring(prepared).findall(".//note")
        if note.find("{*}rest") is None
    ]
    timeline = practice_score_timeline_from_prepared_musicxml(score_path)

    timeline_note_ids = [
        note.render_note_id for note in timeline.notes if any(note.note_id in attack.note_ids for moment in timeline.moments for attack in moment.attacks)
    ]

    assert timeline_note_ids == prepared_note_ids
    assert tuple(n.render_note_id for n in timeline.notes if n.note_id in {i for a in timeline.moments[0].attacks for i in a.note_ids}) == (
        "nv-p1-m1-note2",
        "nv-p1-m1-note3",
        "nv-p1-m1-note4",
    )
    assert tuple(n.render_note_id for n in timeline.notes if n.note_id in {i for a in timeline.moments[1].attacks for i in a.note_ids}) == ("nv-p1-m2-note1",)
