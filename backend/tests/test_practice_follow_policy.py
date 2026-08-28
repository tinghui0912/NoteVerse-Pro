from __future__ import annotations

from app.processing.engines.practice_alignment.expected_event_evaluator import (
    AudioObservation,
    EvaluatorEvidence,
    MidiObservation,
)
from app.processing.engines.practice_alignment.follow_policy import (
    FollowPolicyConfig,
    FollowPolicyProfile,
    FollowPolicy,
    PracticeScopeTargetNotFound,
    PracticeScopeInvalidRange,
    ResolvedContinuousScope,
    WaitForNoteFollowPolicy,
    follow_policy_for_progression,
)
from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreEvent,
    PracticeScoreTimeline,
)


WAIT_FOR_NOTE_POLICY_PROFILE_WITH_MIDI = FollowPolicyProfile(
    progression_mode="WAIT_FOR_NOTE",
    config=FollowPolicyConfig(confidence_threshold=0.75),
    input_source="MIDI",
)


def make_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-0",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-1",
                onset_beat=4.0,
                event_ids=("event-4",),
                render_note_ids=("n2",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-2",
                onset_beat=9.0,
                event_ids=("event-9",),
                render_note_ids=("n3",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=10.0,
    )


def make_update(**overrides):
    update = {
        "beat_position": 3.0,
        "confidence": 0.95,
        "alignment_confidence": 0.95,
        "audio_confidence": 0.95,
        "continuity_confidence": 0.95,
        "visual_confidence": 0.95,
        "validation_confidence": 0.95,
        "input_policy_confidence": 0.95,
        "audio_active": True,
        "match_state": "matched",
    }
    update.update(overrides)
    return update


def make_wait_for_note_timeline() -> PracticeScoreTimeline:
    events = (
        PracticeScoreEvent(
            event_id="event-3",
            onset_beat=3.0,
            duration_beats=1.0,
            pitches=("C4",),
            render_note_ids=("n1",),
            measure_numbers=("1",),
            staff_ids=("1",),
            voice_ids=("1",),
            tie_types=(),
            playable=True,
            entry_candidate=True,
        ),
        PracticeScoreEvent(
            event_id="event-4",
            onset_beat=4.0,
            duration_beats=1.0,
            pitches=("E4", "G4"),
            render_note_ids=("n2", "n3"),
            measure_numbers=("1",),
            staff_ids=("1",),
            voice_ids=("1",),
            tie_types=(),
            playable=True,
            entry_candidate=True,
        ),
    )
    return PracticeScoreTimeline(
        events=events,
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-0",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-1",
                onset_beat=4.0,
                event_ids=("event-4",),
                render_note_ids=("n2", "n3"),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=5.0,
    )


def make_multi_target_wait_for_note_timeline() -> PracticeScoreTimeline:
    events = tuple(
        PracticeScoreEvent(
            event_id=f"event-{index}",
            onset_beat=float(index),
            duration_beats=1.0,
            pitches=(pitch,),
            render_note_ids=(f"n{index}",),
            measure_numbers=(str(index),),
            staff_ids=("1",),
            voice_ids=("1",),
            tie_types=(),
            playable=True,
            entry_candidate=True,
        )
        for index, pitch in enumerate(("C4", "D4", "E4", "F4", "G4"), start=1)
    )
    return PracticeScoreTimeline(
        events=events,
        entry_groups=tuple(
            PracticeEntryGroup(
                group_id=f"entry-{index}",
                onset_beat=float(index),
                event_ids=(f"event-{index}",),
                render_note_ids=(f"n{index}",),
                entry_candidate=True,
            )
            for index in range(1, 6)
        ),
        first_playable_event_id="event-1",
        first_playable_beat=1.0,
        end_beat=6.0,
    )


def test_follow_policy_advances_first_stable_match() -> None:
    decision = FollowPolicy(make_timeline()).decide(make_update())

    assert decision["action"] == "advance"
    assert decision["reason"] == "stable_match"
    assert decision["display_anchor"] == {
        "beat": 3.0,
        "event_id": "event-3",
        "group_id": "entry-0",
        "render_note_ids": ["n1"],
    }


def test_follow_policy_waits_when_first_input_is_not_reliable() -> None:
    decision = FollowPolicy(make_timeline()).decide(
        make_update(visual_confidence=0.4, validation_confidence=0.4)
    )

    assert decision["action"] == "wait"
    assert decision["reason"] == "low_alignment_confidence"
    assert decision["display_anchor"] is None


def test_follow_policy_holds_last_anchor_when_audio_drops_out() -> None:
    policy = FollowPolicy(make_timeline())
    policy.decide(make_update())

    decision = policy.decide(make_update(audio_active=False, match_state="holding_decay"))

    assert decision["action"] == "hold"
    assert decision["reason"] == "holding_position"
    assert decision["experience_state"] == "recovering"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 3.0


def test_follow_policy_holds_on_backward_reacquisition() -> None:
    policy = FollowPolicy(make_timeline())
    policy.decide(make_update(beat_position=4.0))

    decision = policy.decide(make_update(beat_position=3.0))

    assert decision["action"] == "hold"
    assert decision["reason"] == "reacquiring"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 4.0


def test_follow_policy_relocalizes_large_jump_only_when_confident() -> None:
    policy = FollowPolicy(make_timeline())
    policy.decide(make_update(beat_position=3.0))

    decision = policy.decide(make_update(beat_position=9.0, visual_confidence=0.82))

    assert decision["action"] == "relocalize"
    assert decision["reason"] == "large_jump"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 9.0


def test_follow_policy_holds_large_jump_when_recovery_confidence_is_low() -> None:
    policy = FollowPolicy(make_timeline())
    policy.decide(make_update(beat_position=3.0))

    decision = policy.decide(make_update(beat_position=9.0, visual_confidence=0.7))

    assert decision["action"] == "hold"
    assert decision["reason"] == "large_jump"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 3.0


def test_follow_policy_factory_creates_wait_for_note_policy() -> None:
    policy = follow_policy_for_progression(
        make_wait_for_note_timeline(),
        progression_mode="WAIT_FOR_NOTE",
    )

    assert isinstance(policy, WaitForNoteFollowPolicy)
    assert policy.current_expected_group is not None
    assert policy.current_expected_group.pitches == ("C4",)


def test_follow_policy_factory_creates_scoped_continuous_policy() -> None:
    policy = follow_policy_for_progression(
        make_timeline(),
        progression_mode="CONTINUOUS",
        start_expected_group_id="entry-1",
        end_expected_group_id="entry-2",
    )

    assert isinstance(policy, FollowPolicy)
    assert policy.scope_start_beat == 4.0
    assert policy.scope_end_beat == 9.0


def test_continuous_policy_rejects_unknown_scoped_expected_group() -> None:
    try:
        follow_policy_for_progression(
            make_timeline(),
            progression_mode="CONTINUOUS",
            start_expected_group_id="missing-entry",
        )
    except PracticeScopeTargetNotFound as exc:
        assert exc.expected_group_id == "missing-entry"
    else:
        raise AssertionError("Expected invalid continuous scoped practice target to fail.")


def test_continuous_policy_rejects_reversed_scoped_range() -> None:
    try:
        follow_policy_for_progression(
            make_timeline(),
            progression_mode="CONTINUOUS",
            start_expected_group_id="entry-2",
            end_expected_group_id="entry-1",
        )
    except PracticeScopeInvalidRange:
        pass
    else:
        raise AssertionError("Expected reversed continuous scoped practice range to fail.")


def test_continuous_policy_never_accepts_alignment_before_scoped_range() -> None:
    policy = follow_policy_for_progression(
        make_timeline(),
        progression_mode="CONTINUOUS",
        start_expected_group_id="entry-1",
        end_expected_group_id="entry-2",
    )

    decision = policy.decide(make_update(beat_position=3.0))

    assert decision["action"] == "wait"
    assert decision["reason"] == "reacquiring"
    assert decision["experience_state"] == "recovering"
    assert decision["display_anchor"] is None


def test_continuous_policy_never_accepts_alignment_after_scoped_range() -> None:
    policy = follow_policy_for_progression(
        make_timeline(),
        progression_mode="CONTINUOUS",
        start_expected_group_id="entry-0",
        end_expected_group_id="entry-1",
    )
    accepted = policy.decide(make_update(beat_position=4.0))
    assert accepted["action"] == "advance"

    decision = policy.decide(make_update(beat_position=9.0))

    assert decision["action"] == "hold"
    assert decision["reason"] == "reacquiring"
    assert decision["experience_state"] == "recovering"
    assert decision["display_anchor"] == accepted["display_anchor"]


def test_continuous_policy_marks_scoped_range_complete_at_end_boundary() -> None:
    policy = follow_policy_for_progression(
        make_timeline(),
        progression_mode="CONTINUOUS",
        start_expected_group_id="entry-0",
        end_expected_group_id="entry-1",
    )

    decision = policy.decide(make_update(beat_position=4.0))

    assert decision["action"] == "advance"
    assert decision["scope_completed"] is True
    assert decision["display_anchor"] is not None
    assert decision["display_anchor"]["group_id"] == "entry-1"


def test_continuous_policy_does_not_complete_near_end_without_terminal_region() -> None:
    policy = follow_policy_for_progression(
        make_timeline(),
        progression_mode="CONTINUOUS",
        start_expected_group_id="entry-0",
        end_expected_group_id="entry-1",
    )

    decision = policy.decide(make_update(beat_position=3.8))

    assert decision["action"] == "advance"
    assert decision["display_anchor"] is not None
    assert "scope_completed" not in decision


def test_continuous_policy_projects_terminal_region_alignment_to_scoped_end_boundary() -> None:
    policy = follow_policy_for_progression(
        make_timeline(),
        progression_mode="CONTINUOUS",
        continuous_scope=ResolvedContinuousScope(
            start_expected_group_id="entry-0",
            end_expected_group_id="entry-1",
            terminal_reference_region_start_beat=3.8,
        ),
    )

    decision = policy.decide(make_update(beat_position=3.8))

    assert decision["action"] == "advance"
    assert decision["scope_completed"] is True
    assert decision["display_anchor"] is not None
    assert decision["display_anchor"]["beat"] == 4.0
    assert decision["display_anchor"]["group_id"] == "entry-1"


def test_wait_for_note_policy_can_start_from_scoped_expected_group() -> None:
    policy = follow_policy_for_progression(
        make_wait_for_note_timeline(),
        progression_mode="WAIT_FOR_NOTE",
        start_expected_group_id="entry-1",
    )

    assert isinstance(policy, WaitForNoteFollowPolicy)
    assert policy.current_expected_group is not None
    assert policy.current_expected_group.group_id == "entry-1"
    assert policy.current_expected_group.pitches == ("E4", "G4")


def test_wait_for_note_policy_rejects_unknown_scoped_expected_group() -> None:
    try:
        WaitForNoteFollowPolicy(
            make_wait_for_note_timeline(),
            start_expected_group_id="missing-entry",
        )
    except PracticeScopeTargetNotFound as exc:
        assert exc.expected_group_id == "missing-entry"
    else:
        raise AssertionError("Expected invalid scoped practice target to fail.")


def test_wait_for_note_policy_completes_after_last_scoped_target() -> None:
    policy = WaitForNoteFollowPolicy(
        make_wait_for_note_timeline(),
        profile=WAIT_FOR_NOTE_POLICY_PROFILE_WITH_MIDI,
        start_expected_group_id="entry-1",
        end_expected_group_id="entry-1",
    )
    evidence = EvaluatorEvidence.from_midi(MidiObservation(("E4", "G4")))

    evaluation = policy.evaluate_evidence(evidence)
    decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

    assert evaluation.result == "MATCH"
    assert decision["action"] == "advance"
    assert policy.current_expected_group is None


def test_wait_for_note_policy_respects_multi_target_scoped_range_boundaries() -> None:
    policy = WaitForNoteFollowPolicy(
        make_multi_target_wait_for_note_timeline(),
        profile=WAIT_FOR_NOTE_POLICY_PROFILE_WITH_MIDI,
        start_expected_group_id="entry-2",
        end_expected_group_id="entry-4",
    )

    assert policy.current_expected_group is not None
    assert policy.current_expected_group.group_id == "entry-2"

    for pitch, expected_next_group_id in (
        ("D4", "entry-3"),
        ("E4", "entry-4"),
    ):
        evidence = EvaluatorEvidence.from_midi(MidiObservation((pitch,)))
        evaluation = policy.evaluate_evidence(evidence)
        decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

        assert evaluation.result == "MATCH"
        assert decision["action"] == "advance"
        assert decision["display_anchor"] is not None
        assert decision["display_anchor"]["group_id"] == expected_next_group_id
        assert policy.current_expected_group is not None
        assert policy.current_expected_group.group_id == expected_next_group_id

    evidence = EvaluatorEvidence.from_midi(MidiObservation(("F4",)))
    evaluation = policy.evaluate_evidence(evidence)
    decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

    assert evaluation.result == "MATCH"
    assert decision["action"] == "advance"
    assert decision["display_anchor"] is not None
    assert decision["display_anchor"]["group_id"] == "entry-4"
    assert policy.current_expected_group is None

    completed_decision = policy.decide(make_update(beat_position=5.0))
    assert completed_decision["action"] == "hold"
    assert completed_decision["display_anchor"] is None


def test_wait_for_note_policy_rejects_reversed_scoped_range() -> None:
    try:
        WaitForNoteFollowPolicy(
            make_wait_for_note_timeline(),
            start_expected_group_id="entry-1",
            end_expected_group_id="entry-0",
        )
    except PracticeScopeInvalidRange:
        pass
    else:
        raise AssertionError("Expected reversed scoped practice range to fail.")


def test_wait_for_note_policy_waits_at_current_target_without_evaluator_evidence() -> None:
    policy = WaitForNoteFollowPolicy(make_wait_for_note_timeline())

    decision = policy.decide(make_update(beat_position=4.0))

    assert decision["action"] == "wait"
    assert decision["reason"] == "insufficient_input"
    assert decision["experience_state"] == "listening"
    assert decision["display_anchor"] == {
        "beat": 3.0,
        "event_id": "event-3",
        "group_id": "entry-0",
        "render_note_ids": ["n1"],
    }


def test_wait_for_note_policy_advances_only_on_expected_event_match() -> None:
    policy = WaitForNoteFollowPolicy(make_wait_for_note_timeline())
    evidence = EvaluatorEvidence.from_midi(MidiObservation(("C4",)))

    evaluation = policy.evaluate_evidence(evidence)
    decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

    assert evaluation.result == "MATCH"
    assert decision["action"] == "advance"
    assert decision["reason"] == "stable_match"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 4.0
    assert policy.current_expected_group is not None
    assert policy.current_expected_group.pitches == ("E4", "G4")


def test_wait_for_note_policy_holds_on_wrong_note() -> None:
    policy = WaitForNoteFollowPolicy(make_wait_for_note_timeline())
    evidence = EvaluatorEvidence.from_midi(MidiObservation(("D4",)))

    evaluation = policy.evaluate_evidence(evidence)
    decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

    assert evaluation.result == "MISMATCH"
    assert decision["action"] == "hold"
    assert decision["reason"] == "entry_mismatch"
    assert decision["experience_state"] == "possible_wrong_note"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 3.0
    assert policy.current_expected_group is not None
    assert policy.current_expected_group.pitches == ("C4",)


def test_wait_for_note_policy_waits_on_midi_partial_chord() -> None:
    policy = WaitForNoteFollowPolicy(
        make_wait_for_note_timeline(),
        profile=WAIT_FOR_NOTE_POLICY_PROFILE_WITH_MIDI,
    )
    initial_evidence = EvaluatorEvidence.from_midi(MidiObservation(("C4",)))
    initial_evaluation = policy.evaluate_evidence(initial_evidence)
    policy.decide_evaluation(evidence=initial_evidence, evaluation=initial_evaluation)
    evidence = EvaluatorEvidence.from_midi(MidiObservation(("E4",)))

    evaluation = policy.evaluate_evidence(evidence)
    decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

    assert evaluation.result == "PARTIAL"
    assert decision["action"] == "wait"
    assert decision["reason"] == "partial_match"
    assert decision["experience_state"] == "partially_matched"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 4.0
    assert policy.current_expected_group is not None
    assert policy.current_expected_group.pitches == ("E4", "G4")


def test_wait_for_note_policy_best_effort_advances_microphone_partial_chord() -> None:
    policy = WaitForNoteFollowPolicy(make_wait_for_note_timeline())
    initial_evidence = EvaluatorEvidence.from_midi(MidiObservation(("C4",)))
    initial_evaluation = policy.evaluate_evidence(initial_evidence)
    policy.decide_evaluation(evidence=initial_evidence, evaluation=initial_evaluation)
    evidence = EvaluatorEvidence.from_audio(AudioObservation(("E4",), confidence=0.91))

    evaluation = policy.evaluate_evidence(evidence)
    decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

    assert evaluation.result == "PARTIAL"
    assert decision["action"] == "advance"
    assert decision["reason"] == "partial_match"
    assert decision["experience_state"] == "following"
    assert policy.current_expected_group is None


def test_wait_for_note_policy_waits_on_uncertain_audio() -> None:
    policy = WaitForNoteFollowPolicy(make_wait_for_note_timeline())
    evidence = EvaluatorEvidence.from_audio(AudioObservation(("C4",), confidence=0.4))

    evaluation = policy.evaluate_evidence(evidence)
    decision = policy.decide_evaluation(evidence=evidence, evaluation=evaluation)

    assert evaluation.result == "UNCERTAIN"
    assert decision["action"] == "wait"
    assert decision["reason"] == "low_alignment_confidence"
    assert decision["experience_state"] == "heard_but_uncertain"
    anchor = decision["display_anchor"]
    assert anchor is not None
    assert anchor["beat"] == 3.0
