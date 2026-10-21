from app.db.session import engine


def test_async_engine_uses_stale_connection_protection() -> None:
    pool = engine.pool

    assert getattr(pool, "_pre_ping", False) is True
    assert getattr(pool, "_recycle", None) == 3600
    assert getattr(pool, "_pool", None).maxsize == 5
    assert getattr(pool, "_max_overflow", None) == 10
