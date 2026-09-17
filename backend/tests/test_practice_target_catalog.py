from __future__ import annotations

from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline
from app.processing.engines.practice_alignment.target_catalog import practice_target_catalog_from_timeline


def _note_array(np, rows):
    dtype = [
        ("onset_beat", "f4"),
        ("duration_beat", "f4"),
        ("pitch", "i4"),
        ("voice", "i4"),
        ("id", "U32"),
    ]
    return np.array(rows, dtype=dtype)


def _musicxml(tmp_path, notes: str, name: str = "score.musicxml"):
    path = tmp_path / name
    path.write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
{notes}
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )
    return path


def _note_xml(note_id: str, step: str, octave: int, *, voice: int = 1, staff: int = 1, tie: str | None = None) -> str:
    tie_xml = "" if tie is None else f'<tie type="{tie}"/>'
    return f"""      <note id="{note_id}">{tie_xml}<pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>1</duration><voice>{voice}</voice><staff>{staff}</staff></note>"""


def test_target_catalog_preserves_legacy_fields_and_adds_attack_semantics(tmp_path) -> None:
    import numpy as np

    timeline = PracticeScoreTimeline.from_note_array(
        _note_array(np, [(1.0, 1.0, 60, 1, "c4"), (2.0, 1.0, 62, 1, "d4")]),
        musicxml_path=_musicxml(
            tmp_path,
            "\n".join(
                (
                    _note_xml("c4", "C", 4),
                    _note_xml("d4", "D", 4),
                )
            ),
        ),
    )

    catalog = practice_target_catalog_from_timeline(timeline)

    assert tuple(target.group_id for target in catalog.targets) == tuple(
        group.group_id for group in timeline.expected_practice_groups
    )
    assert tuple(target.pitches for target in catalog.targets) == (("C4",), ("D4",))
    assert tuple(target.render_note_ids for target in catalog.targets) == (("c4",), ("d4",))
    assert catalog.targets[0].step_id == timeline.practice_attack_steps[0].step_id
    assert tuple(target.pitch for target in catalog.targets[0].attack_targets) == ("C4",)
    assert catalog.targets[0].continuation == ()


def test_target_catalog_exposes_mixed_tie_continuation_without_legacy_drift(tmp_path) -> None:
    import numpy as np

    timeline = PracticeScoreTimeline.from_note_array(
        _note_array(
            np,
            [
                (1.0, 2.0, 60, 1, "tied-start"),
                (2.0, 1.0, 60, 1, "tied-stop"),
                (2.0, 1.0, 65, 1, "f4"),
                (2.0, 1.0, 69, 1, "a4"),
            ],
        ),
        musicxml_path=_musicxml(
            tmp_path,
            "\n".join(
                (
                    _note_xml("tied-start", "C", 4, tie="start"),
                    _note_xml("tied-stop", "C", 4, tie="stop"),
                    _note_xml("f4", "F", 4),
                    _note_xml("a4", "A", 4),
                )
            ),
        ),
    )

    catalog = practice_target_catalog_from_timeline(timeline)
    mixed_target = catalog.targets[1]

    assert mixed_target.pitches == ("F4", "A4")
    assert mixed_target.render_note_ids == ("f4", "a4")
    assert tuple(target.pitch for target in mixed_target.attack_targets) == ("F4", "A4")
    assert tuple(note.pitch for note in mixed_target.continuation) == ("C4",)
    assert tuple(note.render_note_id for note in mixed_target.continuation) == ("tied-stop",)


def test_target_catalog_consolidates_same_pitch_multi_voice_notes(tmp_path) -> None:
    import numpy as np

    timeline = PracticeScoreTimeline.from_note_array(
        _note_array(np, [(1.0, 1.0, 60, 1, "upper-c4"), (1.0, 1.0, 60, 2, "lower-c4")]),
        musicxml_path=_musicxml(
            tmp_path,
            "\n".join(
                (
                    _note_xml("upper-c4", "C", 4, voice=1, staff=1),
                    _note_xml("lower-c4", "C", 4, voice=2, staff=2),
                )
            ),
        ),
    )

    catalog = practice_target_catalog_from_timeline(timeline)

    assert len(catalog.targets) == 1
    assert catalog.targets[0].pitches == ("C4",)
    assert len(catalog.targets[0].attack_targets) == 1
    attack_target = catalog.targets[0].attack_targets[0]
    assert attack_target.pitch == "C4"
    assert set(attack_target.render_note_ids) == {"upper-c4", "lower-c4"}
    assert len(attack_target.notes) == 2


def test_target_catalog_skips_pure_tie_continuation(tmp_path) -> None:
    import numpy as np

    timeline = PracticeScoreTimeline.from_note_array(
        _note_array(np, [(1.0, 2.0, 60, 1, "c4-start"), (2.0, 1.0, 60, 1, "c4-stop")]),
        musicxml_path=_musicxml(
            tmp_path,
            "\n".join(
                (
                    _note_xml("c4-start", "C", 4, tie="start"),
                    _note_xml("c4-stop", "C", 4, tie="stop"),
                )
            ),
        ),
    )

    catalog = practice_target_catalog_from_timeline(timeline)

    assert tuple(target.onset_beat for target in catalog.targets) == (1.0,)
    assert tuple(step.onset_beat for step in timeline.practice_attack_steps) == (1.0,)


def test_target_catalog_semantic_ids_are_independent_of_render_note_ids(tmp_path) -> None:
    import numpy as np

    first = PracticeScoreTimeline.from_note_array(
        _note_array(np, [(1.0, 1.0, 60, 1, "first-c4"), (2.0, 1.0, 60, 1, "second-c4")]),
        musicxml_path=_musicxml(
            tmp_path,
            "\n".join((_note_xml("first-c4", "C", 4), _note_xml("second-c4", "C", 4))),
            name="first.musicxml",
        ),
    )
    second = PracticeScoreTimeline.from_note_array(
        _note_array(np, [(1.0, 1.0, 60, 1, "render-a"), (2.0, 1.0, 60, 1, "render-b")]),
        musicxml_path=_musicxml(
            tmp_path,
            "\n".join((_note_xml("render-a", "C", 4), _note_xml("render-b", "C", 4))),
            name="second.musicxml",
        ),
    )

    first_catalog = practice_target_catalog_from_timeline(first)
    second_catalog = practice_target_catalog_from_timeline(second)

    assert tuple(target.step_id for target in first_catalog.targets) == tuple(
        target.step_id for target in second_catalog.targets
    )
    assert tuple(target.attack_targets[0].attack_id for target in first_catalog.targets) == tuple(
        target.attack_targets[0].attack_id for target in second_catalog.targets
    )
    assert tuple(target.render_note_ids for target in first_catalog.targets) != tuple(
        target.render_note_ids for target in second_catalog.targets
    )
    assert first_catalog.targets[0].attack_targets[0].attack_id != first_catalog.targets[1].attack_targets[0].attack_id
