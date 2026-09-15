from __future__ import annotations

from typing import Literal, cast

from app.processing.engines.practice_alignment.alignment_metrics import (
    beat_velocity,
    continuity_state,
)
from app.processing.engines.practice_alignment.attempt_assembler import (
    PracticeAttemptAssembler,
    ResolvedPracticeAttempt,
    ResolvedPracticeAttemptBuffer,
    attach_attempt_outcome,
)
from app.processing.engines.practice_alignment.contracts import AlignmentUpdate, InputHealth
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    PracticeEventEvaluation,
)
from app.processing.engines.practice_alignment.follow_policy import (
    AlignmentDecision,
    AlignmentReason,
    WaitForNoteFollowPolicy,
    follow_policy_for_progression,
)
from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline
from app.processing.engines.practice_alignment.step_microphone_verifier import (
    StepMicrophoneVerifier,
    StepVerifierObservation,
    step_verifier_target_from_attack_step,
)
from app.processing.practice_score.score_loader import practice_score_timeline_from_musicxml


_NO_AUDIO_INPUT_HEALTH: InputHealth = {
    "available": False,
    "level": "too_quiet",
    "noise": "good",
    "confidence": 0.0,
}
_GOOD_AUDIO_INPUT_HEALTH: InputHealth = {
    "available": True,
    "level": "good",
    "noise": "good",
    "confidence": 1.0,
}


class StepPracticeEngine:
    """Verifier-driven STEP practice engine for browser PCM streams."""

    def __init__(
        self,
        *,
        score_file_path: str,
        sample_rate: int,
        channels: int,
        frame_format: str,
        progression_mode: str = "WAIT_FOR_NOTE",
        realtime_guidance: str = "GUIDED",
        evaluation_profile: str = "LEARNING",
        input_source: str = "MICROPHONE",
        start_expected_group_id: str | None = None,
        end_expected_group_id: str | None = None,
        step_microphone_verifier: StepMicrophoneVerifier | None = None,
        score_timeline: PracticeScoreTimeline | None = None,
    ) -> None:
        if input_source != "MICROPHONE":
            raise RuntimeError("STEP practice sessions currently require MICROPHONE input.")
        if channels != 1:
            raise RuntimeError("STEP practice sessions require mono audio.")
        if frame_format != "pcm_s16le":
            raise RuntimeError("STEP practice sessions require pcm_s16le audio.")
        if progression_mode != "WAIT_FOR_NOTE":
            raise RuntimeError("STEP practice sessions require WAIT_FOR_NOTE progression.")
        if realtime_guidance != "GUIDED" or evaluation_profile != "LEARNING":
            raise RuntimeError("STEP practice sessions require canonical learning config.")

        self.score_file_path = score_file_path
        self.sample_rate = sample_rate
        self.channels = channels
        self.frame_format = frame_format
        self.progression_mode = progression_mode
        self.realtime_guidance = realtime_guidance
        self.evaluation_profile = evaluation_profile
        self.input_source = input_source
        self.total_bytes = 0
        self._closed = False
        self._audio_received = False
        self._last_beat_position: float | None = None
        self._last_alignment_timestamp_ms: int | None = None
        self._attempt_assembler = PracticeAttemptAssembler()
        self._resolved_practice_attempts = ResolvedPracticeAttemptBuffer()
        self._step_microphone_verifier = step_microphone_verifier
        self._last_step_microphone_verifier_observation: StepVerifierObservation | None = None

        self.score_timeline = score_timeline or practice_score_timeline_from_musicxml(score_file_path)
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
            raise RuntimeError("STEP practice requires Wait For Note policy.")
        self._follow_policy = follow_policy

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None:
        if self._closed:
            raise RuntimeError("STEP practice engine is closed.")
        if not chunk:
            return None

        self.total_bytes += len(chunk)
        self._audio_received = True
        verifier = self._step_microphone_verifier
        if verifier is None:
            return None

        current_group = self._follow_policy.current_expected_group
        current_attack_step = self._follow_policy.current_attack_step
        if current_group is None or current_attack_step is None:
            return self._completed_update()

        target = step_verifier_target_from_attack_step(current_attack_step)
        observation = verifier.observe_audio(chunk, target=target)
        if observation is None:
            return None
        self._last_step_microphone_verifier_observation = observation
        if observation.step_id != current_attack_step.step_id:
            return None
        expected_attack_pitches = tuple(target.pitch for target in current_attack_step.attack_targets)
        if set(observation.observed_attack_pitches) != set(expected_attack_pitches):
            return None

        return self._accepted_observation_update(
            observation=observation,
            current_group=current_group,
        )

    def ingest_midi_event(
        self,
        *,
        event_type: Literal["note_on", "note_off"],
        note_number: int,
        velocity: int,
        timestamp_ms: int,
    ) -> AlignmentUpdate | None:
        _ = (event_type, note_number, velocity, timestamp_ms)
        raise RuntimeError("Microphone STEP practice sessions do not accept MIDI events.")

    def reset_input_buffer(self) -> None:
        self._follow_policy.reset()
        self._attempt_assembler.reset()
        self._last_step_microphone_verifier_observation = None
        self._last_beat_position = None
        self._last_alignment_timestamp_ms = None
        verifier = self._step_microphone_verifier
        if verifier is not None:
            verifier.reset()

    def skip_current_expected_group(self) -> AlignmentUpdate | None:
        if self._closed:
            raise RuntimeError("STEP practice engine is closed.")
        current_group = self._follow_policy.current_expected_group
        if current_group is None:
            return self._completed_update()

        self._clear_verifier_session()
        timestamp_ms = self._timestamp_ms()
        self._attempt_assembler.begin(
            expected_group_id=current_group.group_id,
            timestamp_ms=timestamp_ms,
        )
        evaluation = PracticeEventEvaluation(
            expected_group_id=current_group.group_id,
            result="SKIPPED",
            matched_pitches=(),
            missing_pitches=tuple(current_group.pitches),
            extra_pitches=(),
            confidence=1.0,
            evaluator_version="user-skip-v1",
        )
        outcome = self._attempt_assembler.resolve(evaluation, timestamp_ms=timestamp_ms)
        decision = self._follow_policy.skip_current_group()
        attach_attempt_outcome(decision, outcome)
        display_anchor = decision["display_anchor"]
        beat_position = current_group.onset_beat if display_anchor is None else float(display_anchor["beat"])
        update = self._alignment_update(
            beat_position=beat_position,
            confidence=1.0,
            scope_completed=self._follow_policy.current_expected_group is None,
            decision=decision,
            audio_active=False,
            match_state="matched",
            stream_state="skipped",
            gate_reason="user_skipped",
            queue_decision="user_skipped",
            tonal_signal=False,
            onset_signal=False,
            alignment_state="skipped",
            input_weight=0.0,
        )
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
        return update

    def drain_resolved_practice_attempts(self) -> list[ResolvedPracticeAttempt]:
        return self._resolved_practice_attempts.drain()

    def drain_step_microphone_verifier_observations(self) -> list[StepVerifierObservation]:
        observation = self._last_step_microphone_verifier_observation
        self._last_step_microphone_verifier_observation = None
        return [] if observation is None else [observation]

    def finalize_pending_practice_attempt(
        self,
        *,
        reason: Literal["practice_paused", "practice_finished", "connection_closed"],
    ) -> list[ResolvedPracticeAttempt]:
        _ = reason
        self._clear_verifier_session()
        self._attempt_assembler.clear_current()
        return self.drain_resolved_practice_attempts()

    @property
    def is_ready_for_performance(self) -> bool:
        return not self._closed

    @property
    def input_health(self) -> InputHealth:
        return _GOOD_AUDIO_INPUT_HEALTH if self._audio_received else _NO_AUDIO_INPUT_HEALTH

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        verifier = self._step_microphone_verifier
        if verifier is not None:
            verifier.close()

    def _accepted_observation_update(
        self,
        *,
        observation: StepVerifierObservation,
        current_group,
    ) -> AlignmentUpdate:
        timestamp_ms = self._timestamp_ms()
        self._attempt_assembler.begin(
            expected_group_id=current_group.group_id,
            timestamp_ms=timestamp_ms,
        )
        evaluation = PracticeEventEvaluation(
            expected_group_id=current_group.group_id,
            result="MATCH",
            matched_pitches=tuple(observation.observed_attack_pitches),
            missing_pitches=(),
            extra_pitches=(),
            confidence=observation.confidence,
            evaluator_version="step-microphone-verifier-v1",
        )
        outcome = self._attempt_assembler.resolve(evaluation, timestamp_ms=timestamp_ms)
        evidence = EvaluatorEvidence(
            observed_pitches=tuple(observation.observed_attack_pitches),
            confidence=observation.confidence,
            source="AUDIO",
            onset_beat=current_group.onset_beat,
            alignment_beat=current_group.onset_beat,
        )
        decision = self._follow_policy.decide_evaluation(evidence=evidence, evaluation=evaluation)
        attach_attempt_outcome(decision, outcome)
        display_anchor = decision["display_anchor"]
        beat_position = current_group.onset_beat if display_anchor is None else float(display_anchor["beat"])
        update = self._alignment_update(
            beat_position=beat_position,
            confidence=observation.confidence,
            scope_completed=self._follow_policy.current_expected_group is None,
            decision=decision,
            audio_active=True,
            match_state="matched",
            stream_state="following",
            gate_reason="step_microphone_verifier_match",
            queue_decision="step_microphone_verifier_match",
            tonal_signal=True,
            onset_signal=True,
            alignment_state="matched",
            input_weight=1.0,
        )
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
        return update

    def _completed_update(self) -> AlignmentUpdate:
        decision = self._follow_policy.decide(
            {
                "beat_position": self._score_end_beat,
                "audio_active": True,
                "match_state": "matched",
            }
        )
        return self._alignment_update(
            beat_position=self._score_end_beat,
            confidence=1.0,
            scope_completed=True,
            decision=decision,
            audio_active=True,
            match_state="matched",
            stream_state="following",
            gate_reason="step_completed",
            queue_decision="step_completed",
            tonal_signal=False,
            onset_signal=False,
            alignment_state="matched",
            input_weight=0.0,
        )

    def _alignment_update(
        self,
        *,
        beat_position: float,
        confidence: float,
        scope_completed: bool,
        decision,
        audio_active: bool,
        match_state: str,
        stream_state: str,
        gate_reason: str,
        queue_decision: str,
        tonal_signal: bool,
        onset_signal: bool,
        alignment_state: str,
        input_weight: float,
    ) -> AlignmentUpdate:
        previous_beat_position = self._last_beat_position
        previous_timestamp_ms = self._last_alignment_timestamp_ms
        timestamp_ms = self._timestamp_ms()
        beat_delta = (
            None
            if previous_beat_position is None
            else round(beat_position - previous_beat_position, 3)
        )
        self._last_beat_position = beat_position
        self._last_alignment_timestamp_ms = timestamp_ms
        rounded_confidence = round(float(confidence), 3)
        return {
            "beat_position": round(beat_position, 3),
            "confidence": rounded_confidence,
            "alignment_confidence": rounded_confidence,
            "audio_confidence": rounded_confidence,
            "continuity_confidence": 1.0,
            "visual_confidence": rounded_confidence,
            "timestamp_ms": timestamp_ms,
            "scope_completed": scope_completed,
            "completion_reason": (
                "FINAL_EXPECTED_GROUP_MATCHED" if scope_completed else None
            ),
            "audio_active": audio_active,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "input_health": self.input_health,
            "match_state": match_state,
            "feature_confidence": rounded_confidence,
            "beat_delta": beat_delta,
            "continuity_state": continuity_state(beat_delta),
            "beat_velocity": beat_velocity(
                beat_delta=beat_delta,
                timestamp_ms=timestamp_ms,
                previous_timestamp_ms=previous_timestamp_ms,
            ),
            "stream_state": stream_state,
            "frame_class": "step_verifier",
            "gate_reason": gate_reason,
            "queue_decision": queue_decision,
            "tonal_signal": tonal_signal,
            "onset_signal": onset_signal,
            "spectral_flatness": 0.0,
            "peak_prominence": 0.0,
            "spectral_flux": 0.0,
            "alignment_state": alignment_state,
            "validation_confidence": rounded_confidence,
            "input_weight": round(input_weight, 3),
            "input_policy_confidence": rounded_confidence,
            "decision": decision,
        }

    def _clear_verifier_session(self) -> None:
        self._last_step_microphone_verifier_observation = None
        verifier = self._step_microphone_verifier
        if verifier is not None:
            verifier.reset()
        self._attempt_assembler.clear_current()

    def _timestamp_ms(self) -> int:
        frame_width = max(self.channels * 2, 1)
        total_samples = self.total_bytes / frame_width
        return int((total_samples / max(self.sample_rate, 1)) * 1000)

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
        resolved["decision"] = decision
        resolved["timestamp_ms"] = timestamp_ms
        return cast(AlignmentUpdate, resolved)
