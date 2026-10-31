"""Pure event, moment and attack projection of immutable compiled score facts."""

from app.modules.practice.score.domain import PracticeMeterSegment
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from tests.practice_score_fixtures import compiled_note, compiled_score


def mixed_compiled_score():
    return compiled_score(
        compiled_note(
            render_note_id="n1",
            onset_beat=3.0,
            duration_beats=0.25,
            piano_key=81,
            semantic_locator="p1-m1-e1",
        ),
        compiled_note(
            render_note_id="n2",
            onset_beat=4.0,
            duration_beats=1.0,
            piano_key=60,
            semantic_locator="p1-m1-e2",
        ),
        compiled_note(
            render_note_id="n3",
            onset_beat=4.0,
            duration_beats=1.0,
            piano_key=64,
            semantic_locator="p1-m1-e3",
        ),
        compiled_note(
            render_note_id="n4",
            onset_beat=4.0,
            duration_beats=2.0,
            piano_key=48,
            staff_id="2",
            voice_id="2",
            semantic_locator="p1-m1-e4",
        ),
        compiled_note(
            render_note_id="n5",
            onset_beat=4.05,
            duration_beats=0.5,
            piano_key=67,
            semantic_locator="p1-m1-e5",
        ),
    )


def semantic_identity_compiled_score(note_ids):
    first_id, second_id, third_id = note_ids
    return compiled_score(
        compiled_note(
            render_note_id=first_id,
            onset_beat=1.0,
            duration_beats=1.0,
            piano_key=60,
            measure_number="Display-A",
            semantic_locator="p1-m1-e1",
        ),
        compiled_note(
            render_note_id=second_id,
            onset_beat=1.0,
            duration_beats=1.0,
            piano_key=64,
            measure_number="Display-A",
            semantic_locator="p1-m1-e2",
        ),
        compiled_note(
            render_note_id=third_id,
            onset_beat=2.0,
            duration_beats=1.0,
            piano_key=62,
            measure_number="Display-B",
            semantic_locator="p1-m2-e1",
        ),
    )


def test_practice_score_timeline_preserves_events_and_exact_onset_groups() -> None:
    timeline = practice_timeline_from_compiled(mixed_compiled_score())

    assert timeline.events[0].onset_beat == 3.0
    assert timeline.moments[0].onset_beat == 3.0
    assert timeline.end_beat == 6.0
    assert timeline.playable_onset_beats == (3.0, 4.0, 4.05)

    first_event = timeline.events[0]
    first_notes = [n for n in timeline.notes if n.event_id == first_event.event_id]
    assert first_event.onset_beat == 3.0
    assert [n.piano_key for n in first_notes] == [81]
    assert [n.render_note_id for n in first_notes] == ["n1"]
    assert [n.measure_number for n in first_notes] == ["1"]
    assert [n.staff_id for n in first_notes] == ["1"]
    simultaneous = next(m for m in timeline.moments if m.onset_beat == 4.0)
    assert tuple(a.piano_key for a in simultaneous.attacks) == (60, 64, 48)
    assert set(render_ids(timeline, simultaneous)) == {"n2", "n3", "n4"}
    assert {
        n.voice_id
        for n in timeline.notes
        if n.note_id in {i for a in simultaneous.attacks for i in a.note_ids}
    } == {"1", "2"}
    near = next(m for m in timeline.moments if m.onset_beat == 4.05)
    assert render_ids(timeline, near) == ("n5",)


def test_practice_moment_attacks_cover_simple_new_attacks() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=1.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=2.0,
                duration_beats=1.0,
                piano_key=62,
                semantic_locator="p1-m1-e2",
            ),
        )
    )

    assert tuple(
        tuple(target.piano_key for target in step.attacks) for step in timeline.moments
    ) == ((60,), (62,))
    assert all(step.continuation_note_ids == () for step in timeline.moments)
    assert tuple(tuple(a.piano_key for a in group.attacks) for group in timeline.moments) == (
        (60,),
        (62,),
    )


def test_practice_moment_attacks_keep_same_pitch_without_tie_as_new_attack() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=1.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=2.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e2",
            ),
        )
    )

    assert tuple(
        tuple(target.piano_key for target in step.attacks) for step in timeline.moments
    ) == ((60,), (60,))
    assert tuple(render_ids(timeline, step) for step in timeline.moments) == (
        ("n1",),
        ("n2",),
    )
    assert timeline.moments[0].attacks[0].attack_id != timeline.moments[1].attacks[0].attack_id


def test_practice_score_timeline_preserves_active_meter_and_derived_duration() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=0.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=3.0,
                duration_beats=1.0,
                piano_key=62,
                semantic_locator="p1-m2-e1",
                measure_number="2",
            ),
            meter_segments=(PracticeMeterSegment(0, 3, 4), PracticeMeterSegment(3, 6, 8)),
        )
    )

    first_meter = timeline.meter_at(0.0)
    second_meter = timeline.meter_at(3.0)
    assert (first_meter.numerator, first_meter.denominator) == (3, 4)
    assert (second_meter.numerator, second_meter.denominator) == (6, 8)
    assert timeline.meter_at(0.0).measure_duration_beats == 3.0
    assert timeline.meter_at(3.0).measure_duration_beats == 3.0


def test_practice_score_timeline_uses_revision_stable_group_ids() -> None:
    first_timeline = practice_timeline_from_compiled(mixed_compiled_score())
    second_timeline = practice_timeline_from_compiled(mixed_compiled_score())

    first_group_ids = tuple(group.group_id for group in first_timeline.moments)
    second_group_ids = tuple(group.group_id for group in second_timeline.moments)

    assert first_group_ids == second_group_ids
    assert first_group_ids
    assert len(set(first_group_ids)) == len(first_group_ids)


def test_practice_score_timeline_group_identity_does_not_depend_on_render_note_ids() -> None:
    first_ids = ("render-a", "render-b", "render-c")
    second_ids = ("render-x", "render-y", "render-z")
    first_timeline = practice_timeline_from_compiled(semantic_identity_compiled_score(first_ids))
    second_timeline = practice_timeline_from_compiled(semantic_identity_compiled_score(second_ids))

    assert tuple(group.group_id for group in first_timeline.moments) == tuple(
        group.group_id for group in second_timeline.moments
    )
    assert tuple(
        tuple(n.event_id for n in moment_notes(first_timeline, group))
        for group in first_timeline.moments
    ) == tuple(
        tuple(n.event_id for n in moment_notes(second_timeline, group))
        for group in second_timeline.moments
    )
    assert tuple(render_ids(first_timeline, group) for group in first_timeline.moments) != tuple(
        render_ids(second_timeline, group) for group in second_timeline.moments
    )
    assert tuple(step.group_id for step in first_timeline.moments) == tuple(
        step.group_id for step in second_timeline.moments
    )
    assert tuple(
        tuple(target.attack_id for target in step.attacks) for step in first_timeline.moments
    ) == tuple(
        tuple(target.attack_id for target in step.attacks) for step in second_timeline.moments
    )
    assert tuple(
        tuple(n.event_id for n in moment_notes(first_timeline, step))
        for step in first_timeline.moments
    ) == tuple(
        tuple(n.event_id for n in moment_notes(second_timeline, step))
        for step in second_timeline.moments
    )
    assert tuple(render_ids(first_timeline, step) for step in first_timeline.moments) != tuple(
        render_ids(second_timeline, step) for step in second_timeline.moments
    )


def test_practice_score_timeline_does_not_prompt_tie_continuations() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=3.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
                tie_types=("start",),
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=4.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m2-e1",
                measure_number="2",
                tie_types=("stop",),
            ),
        )
    )

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


def test_practice_score_timeline_follows_multi_fragment_tie_chain_end() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=3.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
                tie_types=("start",),
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=4.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m2-e1",
                measure_number="2",
                tie_types=("stop", "start"),
            ),
            compiled_note(
                render_note_id="n3",
                onset_beat=5.0,
                duration_beats=1.5,
                piano_key=60,
                semantic_locator="p1-m3-e1",
                measure_number="3",
                tie_types=("stop",),
            ),
        )
    )

    assert tuple(group.onset_beat for group in timeline.moments) == (3.0,)
    group = timeline.moments[0]
    assert moment_end(timeline, group.group_id) == 6.5
    assert tuple(step.onset_beat for step in timeline.moments) == (3.0,)
    assert tuple(target.piano_key for target in timeline.moments[0].attacks) == (60,)
    assert timeline.moments[0].continuation_note_ids == ()


def test_practice_score_timeline_keeps_new_onsets_in_mixed_tied_chord() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=4.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
                measure_number="2",
                tie_types=("stop",),
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=4.0,
                duration_beats=1.0,
                piano_key=64,
                semantic_locator="p1-m1-e2",
                measure_number="2",
            ),
            compiled_note(
                render_note_id="n3",
                onset_beat=4.0,
                duration_beats=1.0,
                piano_key=67,
                semantic_locator="p1-m1-e3",
                measure_number="2",
            ),
        )
    )

    assert tuple(group.onset_beat for group in timeline.moments) == (4.0,)
    group = timeline.moments[0]
    assert tuple(a.piano_key for a in group.attacks) == (64, 67)
    assert render_ids(timeline, group) == ("n2", "n3")
    step = timeline.moments[0]
    assert step.onset_beat == 4.0
    assert tuple(target.piano_key for target in step.attacks) == (64, 67)
    assert tuple(note.render_note_id for note in moment_notes(timeline, step)) == ("n2", "n3")
    assert tuple(
        n.piano_key for n in timeline.notes if n.note_id in step.continuation_note_ids
    ) == (60,)
    assert tuple(
        n.render_note_id for n in timeline.notes if n.note_id in step.continuation_note_ids
    ) == ("n1",)


def test_practice_moment_attacks_keep_shared_pitch_rearticulation_in_chord() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=1.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=1.0,
                duration_beats=1.0,
                piano_key=64,
                semantic_locator="p1-m1-e2",
            ),
            compiled_note(
                render_note_id="n3",
                onset_beat=1.0,
                duration_beats=1.0,
                piano_key=67,
                semantic_locator="p1-m1-e3",
            ),
            compiled_note(
                render_note_id="n4",
                onset_beat=2.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e4",
            ),
            compiled_note(
                render_note_id="n5",
                onset_beat=2.0,
                duration_beats=1.0,
                piano_key=65,
                semantic_locator="p1-m1-e5",
            ),
            compiled_note(
                render_note_id="n6",
                onset_beat=2.0,
                duration_beats=1.0,
                piano_key=69,
                semantic_locator="p1-m1-e6",
            ),
        )
    )

    second_step = timeline.moments[1]
    assert tuple(target.piano_key for target in second_step.attacks) == (60, 65, 69)
    assert second_step.continuation_note_ids == ()


def test_practice_moment_attacks_consolidate_same_pitch_multi_voice_staff_targets() -> None:
    timeline = practice_timeline_from_compiled(
        compiled_score(
            compiled_note(
                render_note_id="n1",
                onset_beat=4.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e1",
            ),
            compiled_note(
                render_note_id="n2",
                onset_beat=4.0,
                duration_beats=1.0,
                piano_key=60,
                semantic_locator="p1-m1-e2",
                staff_id="2",
                voice_id="2",
            ),
        )
    )

    step = timeline.moments[0]
    assert tuple(target.piano_key for target in step.attacks) == (60,)
    target = step.attacks[0]
    assert tuple(n.render_note_id for n in timeline.notes if n.note_id in target.note_ids) == (
        "n1",
        "n2",
    )
    assert {n.staff_id for n in timeline.notes if n.note_id in target.note_ids} == {"1", "2"}
    assert {n.voice_id for n in timeline.notes if n.note_id in target.note_ids} == {"1", "2"}
    expected_group = timeline.moments[0]
    assert len(expected_group.attacks) == 1
    assert render_ids(timeline, expected_group) == ("n1", "n2")
    assert len(step.attacks) == 1
    assert len(target.note_ids) == 2


def test_practice_moment_attacks_merge_multi_voice_staff_same_onset() -> None:
    timeline = practice_timeline_from_compiled(mixed_compiled_score())

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
