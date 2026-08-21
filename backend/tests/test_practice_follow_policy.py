from __future__ import annotations

from app.processing.engines.practice_alignment.follow_policy import FollowPolicy
from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreTimeline,
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
    assert decision["display_anchor"]["beat"] == 3.0


def test_follow_policy_holds_on_backward_reacquisition() -> None:
    policy = FollowPolicy(make_timeline())
    policy.decide(make_update(beat_position=4.0))

    decision = policy.decide(make_update(beat_position=3.0))

    assert decision["action"] == "hold"
    assert decision["reason"] == "reacquiring"
    assert decision["display_anchor"]["beat"] == 4.0


def test_follow_policy_relocalizes_large_jump_only_when_confident() -> None:
    policy = FollowPolicy(make_timeline())
    policy.decide(make_update(beat_position=3.0))

    decision = policy.decide(make_update(beat_position=9.0, visual_confidence=0.82))

    assert decision["action"] == "relocalize"
    assert decision["reason"] == "large_jump"
    assert decision["display_anchor"]["beat"] == 9.0


def test_follow_policy_holds_large_jump_when_recovery_confidence_is_low() -> None:
    policy = FollowPolicy(make_timeline())
    policy.decide(make_update(beat_position=3.0))

    decision = policy.decide(make_update(beat_position=9.0, visual_confidence=0.7))

    assert decision["action"] == "hold"
    assert decision["reason"] == "large_jump"
    assert decision["display_anchor"]["beat"] == 3.0
