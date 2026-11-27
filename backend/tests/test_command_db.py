"""The HTTP command boundary owns one transaction shared with authentication."""

from unittest.mock import Mock

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_command_db
from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME
from app.db.models import User
from app.runtime.customer_api.context import get_context


@pytest.mark.parametrize(
    "outcome", ["success", "endpoint_error", "commit_error", "invalid_response"]
)
def test_command_uses_one_authenticated_session_and_finishes_before_response(monkeypatch, outcome):

    db = Mock(spec=Session)
    db.__enter__ = Mock(return_value=db)
    db.__exit__ = Mock(return_value=False)
    factory = Mock(return_value=db)
    user = User(id=1, email="command@example.test", password_hash="hash")
    db.execute.return_value.scalars.return_value.first.return_value = user
    if outcome == "commit_error":
        db.commit.side_effect = RuntimeError("commit unavailable")
    app = FastAPI()
    app.state.settings = get_context().settings
    app.state.session_factory = factory
    app.state.sessions_service = Mock()
    app.state.sessions_service.authenticate.return_value = (user, __import__("uuid").uuid4())

    @app.post("/command", response_model=dict[str, int])
    def command(
        principal: User = Depends(get_current_user),
        command_db: Session = Depends(get_command_db, scope="function"),
    ):
        assert command_db is db and principal is user
        if outcome == "endpoint_error":
            raise RuntimeError("command interrupted")
        return {"id": "invalid" if outcome == "invalid_response" else principal.id}

    with TestClient(app, raise_server_exceptions=False) as client:
        client.cookies.set(
            AUTH_COOKIE_NAME,
            "opaque-session",
        )
        response = client.post("/command")
    assert response.status_code == (200 if outcome == "success" else 500)
    assert factory.call_count == 1
    app.state.sessions_service.authenticate.assert_called_once_with(db, "opaque-session")
    assert db.commit.call_count == (1 if outcome in {"success", "commit_error"} else 0)
    assert db.rollback.call_count >= (0 if outcome == "success" else 1)
    if outcome == "success":
        db.rollback.assert_not_called()
        assert response.json() == {"id": 1}


def test_read_session_does_not_commit(monkeypatch):

    db = Mock(spec=Session)
    db.__enter__ = Mock(return_value=db)
    db.__exit__ = Mock(return_value=False)
    app = FastAPI()
    app.state.session_factory = lambda: db

    @app.get("/read")
    def read(session: Session = Depends(get_db, scope="function")):
        assert session is db
        return {"value": 1}

    with TestClient(app) as client:
        assert client.get("/read").status_code == 200
    db.commit.assert_not_called()
    db.rollback.assert_not_called()


def test_command_rolls_back_base_exception():
    db = Mock(spec=Session)
    boundary = get_command_db(db)
    assert next(boundary) is db
    with pytest.raises(KeyboardInterrupt):
        boundary.throw(KeyboardInterrupt())
    db.commit.assert_not_called()
    db.rollback.assert_called_once()


def test_pure_database_http_routes_explicitly_select_the_transaction_scope():
    from fastapi.routing import APIRoute
    from app.runtime.customer_api.routers.collaboration.router import (
        score_router,
        invite_router,
        me_router,
    )
    from app.runtime.customer_api.routers.library.router import router as library
    from app.runtime.customer_api.routers.guest_previews.router import (
        score_router as guest_settings,
        preview_router,
    )
    from app.runtime.customer_api.routers.notifications.router import router as notifications
    from app.runtime.customer_api.routers.practice.activities.router import router as activities

    for router in (
        score_router,
        invite_router,
        me_router,
        library,
        guest_settings,
        preview_router,
        notifications,
        activities,
    ):
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            command = bool(route.methods & {"POST", "PATCH", "PUT", "DELETE"})
            db_dependencies = [d for d in route.dependant.dependencies if d.name == "db"]
            assert len(db_dependencies) == 1
            assert db_dependencies[0].call is (get_command_db if command else get_db)
            assert db_dependencies[0].scope == "function"
