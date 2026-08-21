from __future__ import annotations

from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline


def note_array(np):
    dtype = [
        ("onset_beat", "f4"),
        ("duration_beat", "f4"),
        ("pitch", "i4"),
        ("voice", "i4"),
        ("id", "U16"),
    ]
    return np.array(
        [
            (3.0, 0.25, 81, 1, "n1"),
            (4.0, 1.0, 60, 1, "n2"),
            (4.0, 1.0, 64, 1, "n3"),
            (4.0, 2.0, 48, 2, "n4"),
            (4.05, 0.5, 67, 1, "n5"),
        ],
        dtype=dtype,
    )


def musicxml_fixture(tmp_path):
    path = tmp_path / "score.musicxml"
    path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <note id="n1"><pitch><step>A</step><octave>5</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n2"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n3"><chord/><pitch><step>E</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n4"><pitch><step>C</step><octave>3</octave></pitch><voice>2</voice><staff>2</staff></note>
      <note id="n5"><pitch><step>G</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )
    return path


def test_practice_score_timeline_preserves_events_and_exact_onset_groups(tmp_path) -> None:
    import numpy as np

    timeline = PracticeScoreTimeline.from_note_array(
        note_array(np),
        musicxml_path=musicxml_fixture(tmp_path),
    )

    assert timeline.first_playable_beat == 3.0
    assert timeline.end_beat == 6.0
    assert timeline.playable_onset_beats == (3.0, 4.0, 4.05)

    first_event = timeline.events[0]
    assert first_event.onset_beat == 3.0
    assert first_event.pitches == ("A5",)
    assert first_event.render_note_ids == ("n1",)
    assert first_event.measure_numbers == ("1",)
    assert first_event.staff_ids == ("1",)
    assert first_event.voice_ids == ("1",)

    chord_event = next(event for event in timeline.events if event.render_note_ids == ("n2", "n3"))
    assert chord_event.pitches == ("C4", "E4")
    assert chord_event.staff_ids == ("1",)
    assert chord_event.voice_ids == ("1",)

    simultaneous_group = next(group for group in timeline.entry_groups if group.onset_beat == 4.0)
    assert set(simultaneous_group.render_note_ids) == {"n2", "n3", "n4"}
    assert len(simultaneous_group.event_ids) == 2

    near_onset_group = next(group for group in timeline.entry_groups if group.onset_beat == 4.05)
    assert near_onset_group.render_note_ids == ("n5",)


def test_practice_score_timeline_does_not_prompt_pure_tie_continuations(tmp_path) -> None:
    import numpy as np

    dtype = [
        ("onset_beat", "f4"),
        ("duration_beat", "f4"),
        ("pitch", "i4"),
        ("voice", "i4"),
        ("id", "U16"),
    ]
    notes = np.array(
        [
            (3.0, 1.0, 60, 1, "n1"),
            (4.0, 1.0, 60, 1, "n2"),
        ],
        dtype=dtype,
    )
    musicxml_path = tmp_path / "tied.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff><tie type="start"/></note>
    </measure>
    <measure number="2">
      <note id="n2"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff><tie type="stop"/></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = PracticeScoreTimeline.from_note_array(notes, musicxml_path=musicxml_path)

    assert timeline.playable_onset_beats == (3.0,)
    tied_continuation = next(event for event in timeline.events if event.render_note_ids == ("n2",))
    assert tied_continuation.tie_types == ("stop",)
    assert tied_continuation.entry_candidate is False
