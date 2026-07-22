from app.core.runtime_checks import ROLE_CHECK_NAMES, RuntimeRole, check_omr_engine


def test_api_runtime_checks_cover_api_owned_dependencies() -> None:
    assert ROLE_CHECK_NAMES[RuntimeRole.API] == (
        "settings",
        "database",
        "storage_quota_policy",
        "redis",
        "storage",
        "soundfont",
        "practice_alignment",
    )


def test_worker_runtime_checks_cover_worker_owned_dependencies() -> None:
    checks = ROLE_CHECK_NAMES[RuntimeRole.WORKER]

    assert "worker_database" in checks
    assert "storage_quota_policy" in checks
    assert "celery_tasks" in checks
    assert "omr_engine" in checks
    assert "render_engine" in checks
    assert "playback_renderer" in checks
    assert "paddleocr_models" in checks
    assert "huggingface_models" in checks
    assert "database" not in checks
    assert "practice_alignment" not in checks


def test_beat_runtime_checks_remain_lightweight() -> None:
    assert ROLE_CHECK_NAMES[RuntimeRole.BEAT] == (
        "settings",
        "redis",
        "beat_state",
    )


def test_all_runtime_checks_are_a_deduplicated_union() -> None:
    all_checks = ROLE_CHECK_NAMES[RuntimeRole.ALL]

    assert len(all_checks) == len(set(all_checks))
    for role in (RuntimeRole.API, RuntimeRole.WORKER, RuntimeRole.BEAT):
        assert set(ROLE_CHECK_NAMES[role]).issubset(all_checks)


def test_omr_runtime_check_accepts_image_source_without_git_metadata(tmp_path, monkeypatch) -> None:
    repo_path = tmp_path / "legato"
    (repo_path / "legato" / "models").mkdir(parents=True)

    monkeypatch.setattr("app.core.runtime_checks.settings.LEGATO_REPO_PATH", str(repo_path))
    monkeypatch.setattr("app.core.runtime_checks.settings.LEGATO_REPO_COMMIT", "abc123")

    result = check_omr_engine()

    assert result.ok is True
    assert result.message == "LEGATO commit=abc123 (image metadata)"
