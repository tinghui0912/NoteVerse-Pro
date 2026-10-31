from __future__ import annotations

from app.processing.practice_score.score_timeline import PracticeScoreTimeline, practice_meter_segments_from_musicxml


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
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
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


def semantic_identity_musicxml_fixture(tmp_path, note_ids: tuple[str, str, str]):
    first_id, second_id, third_id = note_ids
    path = tmp_path / f"score-{first_id}.musicxml"
    path.write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="Display-A">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note id="{first_id}"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note id="{second_id}"><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="Display-B">
      <note id="{third_id}"><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )
    return path


def semantic_identity_note_array(np, note_ids: tuple[str, str, str]):
    dtype = [
        ("onset_beat", "f4"),
        ("duration_beat", "f4"),
        ("pitch", "i4"),
        ("voice", "i4"),
        ("id", "U32"),
    ]
    first_id, second_id, third_id = note_ids
    return np.array(
        [
            (1.0, 1.0, 60, 1, first_id),
            (1.0, 1.0, 64, 1, second_id),
            (2.0, 1.0, 62, 1, third_id),
        ],
        dtype=dtype,
    )


def test_practice_score_timeline_preserves_events_and_exact_onset_groups(tmp_path) -> None:
    import numpy as np

    timeline = timeline_from_notes(
        note_array(np),
        musicxml_path=musicxml_fixture(tmp_path),
    )

    assert timeline.first_playable_beat == 3.0
    assert timeline.end_beat == 6.0
    assert timeline.playable_onset_beats == (3.0, 4.0, 4.05)

    first_event = timeline.events[0]
    first_notes = [n for n in timeline.notes if n.event_id == first_event.event_id]
    assert first_event.onset_beat == 3.0
    assert [n.piano_key for n in first_notes] == [81]
    assert [n.render_note_id for n in first_notes] == ["n1"]
    assert [n.measure_number for n in first_notes] == ["1"]
    assert [n.staff_id for n in first_notes] == ["1"]
    simultaneous = next(m for m in timeline.moments if m.onset_beat == 4.)
    assert tuple(a.piano_key for a in simultaneous.attacks) == (60,64,48)
    assert set(render_ids(timeline, simultaneous)) == {"n2", "n3", "n4"}
    assert {n.voice_id for n in timeline.notes if n.note_id in {i for a in simultaneous.attacks for i in a.note_ids}} == {"1", "2"}
    near = next(m for m in timeline.moments if m.onset_beat == 4.05)
    assert render_ids(timeline, near) == ("n5",)


def test_practice_attack_steps_cover_simple_new_attacks(tmp_path) -> None:
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
            (1.0, 1.0, 60, 1, "n1"),
            (2.0, 1.0, 62, 1, "n2"),
        ],
        dtype=dtype,
    )
    musicxml_path = tmp_path / "c-to-d.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n2"><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = timeline_from_notes(notes, musicxml_path=musicxml_path)

    assert tuple(
        tuple(target.piano_key for target in step.attacks)
        for step in timeline.moments
    ) == ((60,), (62,))
    assert all(step.continuation_note_ids == () for step in timeline.moments)
    assert tuple(tuple(a.piano_key for a in group.attacks) for group in timeline.moments) == (
        (60,),
        (62,),
    )


def test_practice_attack_steps_keep_same_pitch_without_tie_as_new_attack(tmp_path) -> None:
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
            (1.0, 1.0, 60, 1, "n1"),
            (2.0, 1.0, 60, 1, "n2"),
        ],
        dtype=dtype,
    )
    musicxml_path = tmp_path / "rearticulated-c.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n2"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = timeline_from_notes(notes, musicxml_path=musicxml_path)

    assert tuple(
        tuple(target.piano_key for target in step.attacks)
        for step in timeline.moments
    ) == ((60,), (60,))
    assert tuple(render_ids(timeline, step) for step in timeline.moments) == (
        ("n1",),
        ("n2",),
    )
    assert (
        timeline.moments[0].attacks[0].attack_id
        != timeline.moments[1].attacks[0].attack_id
    )


def test_practice_score_timeline_preserves_meter_for_count_in_duration_and_pulses(tmp_path) -> None:
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
            (0.0, 1.0, 60, 1, "n1"),
            (3.0, 1.0, 62, 1, "n2"),
        ],
        dtype=dtype,
    )
    path = tmp_path / "meter.musicxml"
    path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="2">
      <attributes>
        <time><beats>6</beats><beat-type>8</beat-type></time>
      </attributes>
      <note id="n2"><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = timeline_from_notes(notes, musicxml_path=path)

    first_meter = timeline.meter_at(0.0)
    second_meter = timeline.meter_at(3.0)
    assert (first_meter.numerator, first_meter.denominator, first_meter.source) == (3, 4, "MUSICXML")
    assert (second_meter.numerator, second_meter.denominator, second_meter.source) == (6, 8, "MUSICXML")
    assert timeline.count_in_duration_beats_at(0.0) == 3.0
    assert timeline.count_in_duration_beats_at(3.0) == 3.0
    assert timeline.count_in_pulses_at(0.0) == 3
    assert timeline.count_in_pulses_at(3.0) == 6


def test_practice_score_timeline_uses_revision_stable_expected_group_ids(tmp_path) -> None:
    import numpy as np

    musicxml_path = musicxml_fixture(tmp_path)
    first_timeline = timeline_from_notes(
        note_array(np),
        musicxml_path=musicxml_path,
    )
    second_timeline = timeline_from_notes(
        note_array(np),
        musicxml_path=musicxml_path,
    )

    first_group_ids = tuple(group.group_id for group in first_timeline.moments)
    second_group_ids = tuple(group.group_id for group in second_timeline.moments)

    assert first_group_ids == second_group_ids
    assert first_group_ids
    assert not any(group_id in {"entry-0", "entry-1", "entry-2"} for group_id in first_group_ids)


def test_practice_score_timeline_group_identity_does_not_depend_on_render_note_ids(
    tmp_path,
) -> None:
    import numpy as np

    first_ids = ("render-v1-a", "render-v1-b", "render-v1-c")
    second_ids = ("render-v2-a", "render-v2-b", "render-v2-c")
    first_timeline = timeline_from_notes(
        semantic_identity_note_array(np, first_ids),
        musicxml_path=semantic_identity_musicxml_fixture(tmp_path, first_ids),
    )
    second_timeline = timeline_from_notes(
        semantic_identity_note_array(np, second_ids),
        musicxml_path=semantic_identity_musicxml_fixture(tmp_path, second_ids),
    )

    assert tuple(group.group_id for group in first_timeline.moments) == tuple(
        group.group_id for group in second_timeline.moments
    )
    assert tuple(tuple(n.event_id for n in moment_notes(first_timeline, group)) for group in first_timeline.moments) == tuple(
        tuple(n.event_id for n in moment_notes(second_timeline, group)) for group in second_timeline.moments
    )
    assert tuple(render_ids(first_timeline, group) for group in first_timeline.moments) != tuple(
        render_ids(second_timeline, group) for group in second_timeline.moments
    )
    assert tuple(step.group_id for step in first_timeline.moments) == tuple(
        step.group_id for step in second_timeline.moments
    )
    assert tuple(
        tuple(target.attack_id for target in step.attacks)
        for step in first_timeline.moments
    ) == tuple(
        tuple(target.attack_id for target in step.attacks)
        for step in second_timeline.moments
    )
    assert tuple(tuple(n.event_id for n in moment_notes(first_timeline, step)) for step in first_timeline.moments) == tuple(
        tuple(n.event_id for n in moment_notes(second_timeline, step)) for step in second_timeline.moments
    )
    assert tuple(render_ids(first_timeline, step) for step in first_timeline.moments) != tuple(
        render_ids(second_timeline, step) for step in second_timeline.moments
    )


def test_practice_score_timeline_does_not_prompt_tie_continuations(tmp_path) -> None:
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
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
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

    timeline = timeline_from_notes(notes, musicxml_path=musicxml_path)

    assert timeline.playable_onset_beats == (3.0,)
    assert tuple(group.onset_beat for group in timeline.moments) == (3.0,)
    tied_continuation = next(note for note in timeline.notes if note.render_note_id == "n2")
    assert tied_continuation.tie_types == ("stop",)
    assert "stop" in tied_continuation.tie_types
    group = timeline.moments[0]
    assert moment_end(timeline, group.group_id) == 5.0
    assert tuple(step.onset_beat for step in timeline.moments) == (3.0,)
    assert tuple(target.piano_key for target in timeline.moments[0].attacks) == (60,)
    assert timeline.moments[0].continuation_note_ids == ()


def test_practice_score_timeline_follows_multi_fragment_tie_chain_end(tmp_path) -> None:
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
            (5.0, 1.5, 60, 1, "n3"),
        ],
        dtype=dtype,
    )
    musicxml_path = tmp_path / "tied-chain.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff><tie type="start"/></note>
    </measure>
    <measure number="2">
      <note id="n2"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff><tie type="stop"/><tie type="start"/></note>
    </measure>
    <measure number="3">
      <note id="n3"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff><tie type="stop"/></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = timeline_from_notes(notes, musicxml_path=musicxml_path)

    assert tuple(group.onset_beat for group in timeline.moments) == (3.0,)
    group = timeline.moments[0]
    assert moment_end(timeline, group.group_id) == 6.5
    assert tuple(step.onset_beat for step in timeline.moments) == (3.0,)
    assert tuple(target.piano_key for target in timeline.moments[0].attacks) == (60,)
    assert timeline.moments[0].continuation_note_ids == ()


def test_practice_score_timeline_keeps_new_onsets_in_mixed_tied_chord(tmp_path) -> None:
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
            (4.0, 1.0, 60, 1, "n1"),
            (4.0, 1.0, 64, 1, "n2"),
            (4.0, 1.0, 67, 1, "n3"),
        ],
        dtype=dtype,
    )
    musicxml_path = tmp_path / "mixed-tied-chord.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="2">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff><tie type="stop"/></note>
      <note id="n2"><chord/><pitch><step>E</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n3"><chord/><pitch><step>G</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = timeline_from_notes(notes, musicxml_path=musicxml_path)

    assert tuple(group.onset_beat for group in timeline.moments) == (4.0,)
    group = timeline.moments[0]
    assert tuple(a.piano_key for a in group.attacks) == (64,67)
    assert render_ids(timeline, group) == ("n2", "n3")
    step = timeline.moments[0]
    assert step.onset_beat == 4.0
    assert tuple(target.piano_key for target in step.attacks) == (64, 67)
    assert tuple(note.render_note_id for note in moment_notes(timeline, step)) == ("n2", "n3")
    assert tuple(n.piano_key for n in timeline.notes if n.note_id in step.continuation_note_ids) == (60,)
    assert tuple(n.render_note_id for n in timeline.notes if n.note_id in step.continuation_note_ids) == ("n1",)


def test_practice_attack_steps_keep_shared_pitch_rearticulation_in_chord(tmp_path) -> None:
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
            (1.0, 1.0, 60, 1, "n1"),
            (1.0, 1.0, 64, 1, "n2"),
            (1.0, 1.0, 67, 1, "n3"),
            (2.0, 1.0, 60, 1, "n4"),
            (2.0, 1.0, 65, 1, "n5"),
            (2.0, 1.0, 69, 1, "n6"),
        ],
        dtype=dtype,
    )
    musicxml_path = tmp_path / "shared-rearticulated.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n2"><chord/><pitch><step>E</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n3"><chord/><pitch><step>G</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n4"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n5"><chord/><pitch><step>F</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n6"><chord/><pitch><step>A</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = timeline_from_notes(notes, musicxml_path=musicxml_path)

    second_step = timeline.moments[1]
    assert tuple(target.piano_key for target in second_step.attacks) == (60, 65, 69)
    assert second_step.continuation_note_ids == ()


def test_practice_attack_steps_consolidate_same_pitch_multi_voice_staff_targets(
    tmp_path,
) -> None:
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
            (4.0, 1.0, 60, 1, "n1"),
            (4.0, 1.0, 60, 2, "n2"),
        ],
        dtype=dtype,
    )
    musicxml_path = tmp_path / "same-pitch-multi-voice.musicxml"
    musicxml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note id="n2"><pitch><step>C</step><octave>4</octave></pitch><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    timeline = timeline_from_notes(notes, musicxml_path=musicxml_path)

    step = timeline.moments[0]
    assert tuple(target.piano_key for target in step.attacks) == (60,)
    target = step.attacks[0]
    assert tuple(n.render_note_id for n in timeline.notes if n.note_id in target.note_ids) == ("n1", "n2")
    assert {n.staff_id for n in timeline.notes if n.note_id in target.note_ids} == {"1", "2"}
    assert {n.voice_id for n in timeline.notes if n.note_id in target.note_ids} == {"1", "2"}
    expected_group = timeline.moments[0]
    assert len(expected_group.attacks) == 1
    assert render_ids(timeline, expected_group) == ("n1", "n2")
    assert len(step.attacks) == 1
    assert len(target.note_ids) == 2


def test_practice_attack_steps_merge_multi_voice_staff_same_onset(tmp_path) -> None:
    import numpy as np

    timeline = timeline_from_notes(
        note_array(np),
        musicxml_path=musicxml_fixture(tmp_path),
    )

    step = next(item for item in timeline.moments if item.onset_beat == 4.0)
    assert tuple(target.piano_key for target in step.attacks) == (60, 64, 48)
    assert {n.staff_id for n in moment_notes(timeline, step)} == {"1", "2"}
    assert {n.voice_id for n in moment_notes(timeline, step)} == {"1", "2"}
    assert step.continuation_note_ids == ()


def render_ids(timeline, moment):
    ids = {i for a in moment.attacks for i in a.note_ids}
    return tuple(n.render_note_id for n in timeline.notes if n.note_id in ids)


def moment_end(timeline, group_id):
    return next(m.canonical_end_beat for m in timeline.moments if m.group_id == group_id)


def moment_notes(timeline, moment):
    ids = {i for attack in moment.attacks for i in attack.note_ids}
    return [n for n in timeline.notes if n.note_id in ids]


def timeline_from_notes(note_array, *, musicxml_path):
    return PracticeScoreTimeline.from_note_array(
        note_array, musicxml_path=musicxml_path,
        meter_segments=practice_meter_segments_from_musicxml(musicxml_path),
    )
