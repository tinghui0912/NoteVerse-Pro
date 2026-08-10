from __future__ import annotations

from app.processing.engines.practice_alignment.audio_activity import (
    AudioGateConfig,
    AudioFrameFeatures,
    FrameClassifier,
    OltwInputPolicy,
    PracticeAudioGate,
)


def classify(features: AudioFrameFeatures) -> str:
    return FrameClassifier().classify(
        features,
        rms_gate=0.01,
        peak_gate=0.04,
        calibrated_flux_gate=0.35,
    )


def test_frame_classifier_marks_low_level_input_as_silence() -> None:
    features = AudioFrameFeatures(
        rms=0.0005,
        peak=0.002,
        tonal_signal=False,
        spectral_flatness=1.0,
        peak_prominence=0.0,
        spectral_flux=0.0,
        onset_signal=False,
    )

    assert classify(features) == "silence"


def test_frame_classifier_prefers_tonal_class_for_tonal_frames() -> None:
    features = AudioFrameFeatures(
        rms=0.02,
        peak=0.06,
        tonal_signal=True,
        spectral_flatness=0.2,
        peak_prominence=20.0,
        spectral_flux=0.5,
        onset_signal=True,
    )

    assert classify(features) == "tonal"


def test_frame_classifier_marks_non_tonal_flux_as_transient() -> None:
    features = AudioFrameFeatures(
        rms=0.02,
        peak=0.08,
        tonal_signal=False,
        spectral_flatness=0.8,
        peak_prominence=3.0,
        spectral_flux=0.5,
        onset_signal=False,
    )

    assert classify(features) == "transient"


def test_frame_classifier_marks_non_tonal_low_flux_as_uncertain() -> None:
    features = AudioFrameFeatures(
        rms=0.004,
        peak=0.02,
        tonal_signal=False,
        spectral_flatness=0.55,
        peak_prominence=6.0,
        spectral_flux=0.1,
        onset_signal=False,
    )

    assert classify(features) == "uncertain"


def make_audio_gate() -> PracticeAudioGate:
    return PracticeAudioGate(
        AudioGateConfig(
            rms_gate=0.01,
            peak_gate=0.04,
            start_rms_gate=0.01,
            start_peak_gate=0.04,
            min_peak_prominence=8.0,
            onset_hold_frames=6,
        )
    )


def test_audio_gate_accepts_strong_tonal_start() -> None:
    features = AudioFrameFeatures(
        rms=0.03,
        peak=0.08,
        tonal_signal=True,
        spectral_flatness=0.2,
        peak_prominence=30.0,
        spectral_flux=0.4,
        onset_signal=True,
        frame_class="tonal",
    )

    decision = make_audio_gate().start_signal(
        features,
        effective_rms_gate=0.025,
        effective_peak_gate=0.06,
    )

    assert decision.active is True
    assert decision.reason == "strong_start"


def test_audio_gate_rejects_start_with_low_prominence() -> None:
    features = AudioFrameFeatures(
        rms=0.03,
        peak=0.08,
        tonal_signal=True,
        spectral_flatness=0.2,
        peak_prominence=12.0,
        spectral_flux=0.4,
        onset_signal=True,
        frame_class="tonal",
    )

    decision = make_audio_gate().start_signal(
        features,
        effective_rms_gate=0.025,
        effective_peak_gate=0.06,
    )

    assert decision.active is False
    assert decision.reason == "low_prominence"


def test_audio_gate_marks_tonal_runtime_energy_as_music_activity() -> None:
    features = AudioFrameFeatures(
        rms=0.008,
        peak=0.015,
        tonal_signal=True,
        spectral_flatness=0.22,
        peak_prominence=18.0,
        spectral_flux=0.05,
        onset_signal=False,
        frame_class="tonal",
    )

    decision = make_audio_gate().runtime_activity(
        features,
        calibrated_rms_gate=0.01,
        calibrated_peak_gate=0.04,
        total_frames=20,
        last_onset_frame=10,
        in_keepalive_window=True,
    )

    assert decision.active is True
    assert decision.reason == "tonal_runtime_energy"
    assert decision.activity_marker == "music"


def test_audio_gate_keeps_session_alive_inside_keepalive_window() -> None:
    features = AudioFrameFeatures(
        rms=0.03,
        peak=0.08,
        tonal_signal=False,
        spectral_flatness=0.8,
        peak_prominence=4.0,
        spectral_flux=0.5,
        onset_signal=False,
        frame_class="transient",
    )

    decision = make_audio_gate().runtime_activity(
        features,
        calibrated_rms_gate=0.01,
        calibrated_peak_gate=0.04,
        total_frames=20,
        last_onset_frame=10,
        in_keepalive_window=True,
    )

    assert decision.active is True
    assert decision.reason == "session_keepalive_window"
    assert decision.activity_marker is None


def test_audio_gate_rejects_non_tonal_runtime_activity_outside_keepalive_window() -> None:
    features = AudioFrameFeatures(
        rms=0.03,
        peak=0.08,
        tonal_signal=False,
        spectral_flatness=0.8,
        peak_prominence=4.0,
        spectral_flux=0.5,
        onset_signal=False,
        frame_class="transient",
    )

    decision = make_audio_gate().runtime_activity(
        features,
        calibrated_rms_gate=0.01,
        calibrated_peak_gate=0.04,
        total_frames=20,
        last_onset_frame=10,
        in_keepalive_window=False,
    )

    assert decision.active is False
    assert decision.reason == "not_tonal"


def test_oltw_input_policy_reports_not_started() -> None:
    decision = OltwInputPolicy().decide(
        started=False,
        has_previous_chunk=True,
        runtime_active=True,
        frame_class="tonal",
    )

    assert decision.should_queue is False
    assert decision.reason == "not_started"
    assert decision.confidence_ceiling == 0.0


def test_oltw_input_policy_reports_priming_context() -> None:
    decision = OltwInputPolicy().decide(
        started=True,
        has_previous_chunk=False,
        runtime_active=True,
        frame_class="tonal",
    )

    assert decision.should_queue is False
    assert decision.reason == "priming_context"


def test_oltw_input_policy_holds_inactive_runtime_frames() -> None:
    decision = OltwInputPolicy().decide(
        started=True,
        has_previous_chunk=True,
        runtime_active=False,
        frame_class="transient",
    )

    assert decision.should_queue is False
    assert decision.reason == "hold_transient"
    assert decision.confidence_ceiling == 0.0


def test_oltw_input_policy_queues_active_runtime_frames() -> None:
    decision = OltwInputPolicy().decide(
        started=True,
        has_previous_chunk=True,
        runtime_active=True,
        frame_class="tonal",
    )

    assert decision.should_queue is True
    assert decision.reason == "queued_tonal"
    assert decision.input_weight == 1.0
    assert decision.confidence_ceiling == 1.0


def test_oltw_input_policy_holds_tonal_decay_with_low_confidence() -> None:
    decision = OltwInputPolicy().decide(
        started=True,
        has_previous_chunk=True,
        runtime_active=False,
        frame_class="tonal",
    )

    assert decision.should_queue is False
    assert decision.reason == "hold_tonal_decay"
    assert decision.confidence_ceiling == 0.35


def test_oltw_input_policy_holds_uncertain_input_with_low_confidence() -> None:
    decision = OltwInputPolicy().decide(
        started=True,
        has_previous_chunk=True,
        runtime_active=False,
        frame_class="uncertain",
    )

    assert decision.should_queue is False
    assert decision.reason == "hold_uncertain_input"
    assert decision.confidence_ceiling == 0.2
