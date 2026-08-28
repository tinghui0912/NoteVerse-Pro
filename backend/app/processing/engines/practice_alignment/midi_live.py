from __future__ import annotations

from pathlib import Path
from typing import Literal, cast

from app.processing.engines.practice_alignment.contracts import AlignmentUpdate, InputHealth
from app.processing.engines.practice_alignment.attempt_assembler import (
    PracticeAttemptAssembler,
    PracticeAttemptOutcome,
    ResolvedPracticeAttempt,
    ResolvedPracticeAttemptBuffer,
    attach_attempt_outcome,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    MidiObservation,
)
from app.processing.engines.practice_alignment.follow_policy import (
    AlignmentDecision,
    AlignmentReason,
    WaitForNoteFollowPolicy,
    follow_policy_for_progression,
)
from app.processing.engines.practice_alignment.musicxml_stable_ids import (
    prepared_musicxml_path_for_practice,
)
from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline


_MIDI_PITCH_CLASSES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_GOOD_MIDI_INPUT_HEALTH: InputHealth = {
    "available": True,
    "level": "good",
    "noise": "good",
    "confidence": 1.0,
}


class MidiPracticeEngine:
    """Expected-event engine for low-latency MIDI Wait For Note sessions."""

    def __init__(
        self,
        *,
        score_file_path: str,
        progression_mode: str,
        input_source: str,
        start_expected_group_id: str | None = None,
        end_expected_group_id: str | None = None,
    ) -> None:
        if input_source != "MIDI":
            raise RuntimeError("MidiPracticeEngine requires MIDI input.")
        if progression_mode != "WAIT_FOR_NOTE":
            raise RuntimeError("MIDI practice currently supports WAIT_FOR_NOTE sessions.")

        import partitura

        self.score_file_path = str(Path(score_file_path))
        self.progression_mode = progression_mode
        self.input_source = input_source
        with prepared_musicxml_path_for_practice(self.score_file_path) as prepared_path:
            self.score_part = partitura.load_score_as_part(str(prepared_path))
            self.score_timeline = PracticeScoreTimeline.from_note_array(
                self.score_part.note_array(),
                musicxml_path=prepared_path,
            )
        if self.score_timeline.first_playable_beat is None:
            raise RuntimeError("Practice score timeline contains no playable events.")
        self._score_end_beat = self.score_timeline.end_beat
        follow_policy = follow_policy_for_progression(
            self.score_timeline,
            progression_mode=progression_mode,
            input_source=input_source,
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
        )
        if not isinstance(follow_policy, WaitForNoteFollowPolicy):
            raise RuntimeError("MIDI practice requires Wait For Note policy.")
        self._follow_policy = follow_policy
        self._active_notes: set[int] = set()
        self._attempt_assembler = PracticeAttemptAssembler()
        self._pending_attempt_outcome: PracticeAttemptOutcome | None = None
        self._pending_attempt_update: AlignmentUpdate | None = None
        self._resolved_practice_attempts = ResolvedPracticeAttemptBuffer()
        self._last_alignment: AlignmentUpdate | None = None
        self._last_timestamp_ms = 0
        self._closed = False

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None:
        _ = chunk
        raise RuntimeError("MIDI practice sessions do not accept audio chunks.")

    def ingest_midi_event(
        self,
        *,
        event_type: Literal["note_on", "note_off"],
        note_number: int,
        velocity: int,
        timestamp_ms: int,
    ) -> AlignmentUpdate | None:
        if self._closed:
            raise RuntimeError("MIDI practice engine is closed.")
        if note_number < 0 or note_number > 127:
            raise RuntimeError("MIDI note_number must be between 0 and 127.")
        if velocity < 0 or velocity > 127:
            raise RuntimeError("MIDI velocity must be between 0 and 127.")

        self._last_timestamp_ms = timestamp_ms
        normalized_type = "note_off" if event_type == "note_on" and velocity == 0 else event_type
        if normalized_type == "note_off":
            self._active_notes.discard(note_number)
            if not self._active_notes and self._pending_attempt_update is not None:
                resolved_update = self._resolved_attempt_update(self._pending_attempt_update, timestamp_ms)
                self._pending_attempt_update = None
                self._last_alignment = resolved_update
                return resolved_update
            return None

        follow_policy = self._follow_policy
        current_group = follow_policy.current_expected_group
        if current_group is None:
            return self._completed_update()
        if not self._active_notes:
            self._attempt_assembler.begin(
                expected_group_id=current_group.group_id,
                timestamp_ms=timestamp_ms,
            )
        self._active_notes.add(note_number)

        evidence = EvaluatorEvidence.from_midi(
            MidiObservation(
                observed_pitches=tuple(_midi_pitch_name(note) for note in sorted(self._active_notes)),
                onset_beat=current_group.onset_beat,
            )
        )
        evaluation = follow_policy.evaluate_evidence(evidence)
        should_resolve = evaluation.result == "MATCH"
        if should_resolve:
            outcome = self._attempt_assembler.resolve(evaluation, timestamp_ms=timestamp_ms)
        else:
            outcome = self._attempt_assembler.pending(evaluation)

        decision = follow_policy.decide_evaluation(evidence=evidence, evaluation=evaluation)
        if decision["action"] == "advance":
            self._active_notes.clear()
            self._pending_attempt_update = None
            self._pending_attempt_outcome = None
        attach_attempt_outcome(decision, outcome)

        display_anchor = decision["display_anchor"]
        beat_position = current_group.onset_beat if display_anchor is None else float(display_anchor["beat"])
        update: AlignmentUpdate = {
            "beat_position": round(beat_position, 3),
            "confidence": round(evaluation.confidence, 3),
            "alignment_confidence": 1.0,
            "audio_confidence": 1.0,
            "continuity_confidence": 1.0,
            "visual_confidence": round(evaluation.confidence, 3),
            "timestamp_ms": timestamp_ms,
            "scope_completed": follow_policy.current_expected_group is None,
            "completion_reason": (
                "FINAL_EXPECTED_GROUP_MATCHED"
                if follow_policy.current_expected_group is None
                else None
            ),
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "input_health": _GOOD_MIDI_INPUT_HEALTH,
            "match_state": "matched",
            "feature_confidence": round(evaluation.confidence, 3),
            "beat_delta": None,
            "stream_state": "following",
            "frame_class": "unknown",
            "gate_reason": "midi_event",
            "queue_decision": "midi_event",
            "tonal_signal": True,
            "onset_signal": True,
            "spectral_flatness": 0.0,
            "peak_prominence": 0.0,
            "spectral_flux": 0.0,
            "alignment_state": "matched",
            "continuity_state": "stable",
            "beat_velocity": None,
            "validation_confidence": round(evaluation.confidence, 3),
            "input_weight": 1.0,
            "input_policy_confidence": 1.0,
            "decision": decision,
        }
        if decision["attempt_state"] == "pending":
            self._pending_attempt_update = update
            self._pending_attempt_outcome = outcome
        self._resolved_practice_attempts.append_for_expected_group(
            outcome=outcome,
            action=decision["action"],
            resolution_reason=decision["reason"],
            experience_state=decision["experience_state"],
            expected_group=current_group,
            update_confidence=update["confidence"],
            update_timestamp_ms=update["timestamp_ms"],
            validation_confidence=update.get("validation_confidence"),
            input_policy_confidence=update.get("input_policy_confidence"),
        )
        self._last_alignment = update
        return update

    def reset_input_buffer(self) -> None:
        self._active_notes.clear()
        self._attempt_assembler.clear_current()
        self._pending_attempt_outcome = None
        self._pending_attempt_update = None

    def drain_resolved_practice_attempts(self) -> list[ResolvedPracticeAttempt]:
        return self._resolved_practice_attempts.drain()

    def finalize_pending_practice_attempt(
        self,
        *,
        reason: Literal["practice_paused", "practice_finished", "connection_closed"],
    ) -> list[ResolvedPracticeAttempt]:
        if self._pending_attempt_update is None:
            self.reset_input_buffer()
            return self.drain_resolved_practice_attempts()

        resolved_update = self._resolved_attempt_update(
            self._pending_attempt_update,
            self._last_timestamp_ms,
            reason=reason,
        )
        self._pending_attempt_update = None
        self._pending_attempt_outcome = None
        self._active_notes.clear()
        self._attempt_assembler.clear_current()
        self._last_alignment = resolved_update
        return self.drain_resolved_practice_attempts()

    @property
    def is_ready_for_performance(self) -> bool:
        return True

    @property
    def input_health(self) -> InputHealth:
        return _GOOD_MIDI_INPUT_HEALTH

    def close(self) -> None:
        self._closed = True
        self.finalize_pending_practice_attempt(reason="connection_closed")

    def _completed_update(self) -> AlignmentUpdate:
        decision = self._follow_policy.decide(
            {
                "beat_position": self._score_end_beat,
                "audio_active": True,
                "match_state": "matched",
            }
        )
        return {
            "beat_position": round(self._score_end_beat, 3),
            "confidence": 1.0,
            "alignment_confidence": 1.0,
            "audio_confidence": 1.0,
            "continuity_confidence": 1.0,
            "visual_confidence": 1.0,
            "timestamp_ms": self._last_timestamp_ms,
            "scope_completed": True,
            "completion_reason": "FINAL_EXPECTED_GROUP_MATCHED",
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "input_health": _GOOD_MIDI_INPUT_HEALTH,
            "match_state": "matched",
            "feature_confidence": 1.0,
            "beat_delta": None,
            "stream_state": "following",
            "frame_class": "unknown",
            "gate_reason": "midi_completed",
            "queue_decision": "midi_completed",
            "tonal_signal": True,
            "onset_signal": True,
            "spectral_flatness": 0.0,
            "peak_prominence": 0.0,
            "spectral_flux": 0.0,
            "alignment_state": "matched",
            "continuity_state": "stable",
            "beat_velocity": None,
            "validation_confidence": 1.0,
            "input_weight": 1.0,
            "input_policy_confidence": 1.0,
            "decision": decision,
        }

    def _resolved_attempt_update(
        self,
        update: AlignmentUpdate,
        timestamp_ms: int,
        *,
        reason: AlignmentReason | None = None,
    ) -> AlignmentUpdate:
        resolved = dict(update)
        decision = cast(AlignmentDecision, dict(update["decision"]))
        if reason is not None:
            decision["action"] = "hold"
            decision["reason"] = reason
        outcome = None
        if self._pending_attempt_outcome is not None:
            outcome = self._attempt_assembler.resolve(
                self._pending_attempt_outcome.evaluation,
                timestamp_ms=timestamp_ms,
            )
        attach_attempt_outcome(decision, outcome)
        resolved["decision"] = decision
        resolved["timestamp_ms"] = timestamp_ms
        current_group = self._follow_policy.current_expected_group
        if current_group is not None:
            self._resolved_practice_attempts.append_for_expected_group(
                outcome=outcome,
                action=decision["action"],
                resolution_reason=decision["reason"],
                experience_state=decision["experience_state"],
                expected_group=current_group,
                update_confidence=cast(float, resolved["confidence"]),
                update_timestamp_ms=cast(int, resolved["timestamp_ms"]),
                validation_confidence=cast(float | None, resolved.get("validation_confidence")),
                input_policy_confidence=cast(float | None, resolved.get("input_policy_confidence")),
            )
        return cast(AlignmentUpdate, resolved)


def _midi_pitch_name(note_number: int) -> str:
    octave = note_number // 12 - 1
    return f"{_MIDI_PITCH_CLASSES[note_number % 12]}{octave}"
