from app.processing.engines.practice_alignment.profile import PracticeAudioProfile


def test_practice_audio_profile_derives_calibration_samples_from_audio_duration() -> None:
    profile = PracticeAudioProfile(frame_rate=30, calibration_duration_seconds=1.0)

    assert profile.calibration_sample_count(sample_rate=16_000) == 16_000


def test_practice_audio_profile_keeps_calibration_duration_independent_of_engine_frame_rate() -> None:
    profile = PracticeAudioProfile(frame_rate=60, calibration_duration_seconds=1.0)

    assert profile.calibration_sample_count(sample_rate=16_000) == 16_000
