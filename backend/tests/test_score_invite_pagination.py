"""Score collaboration keyset continuation, HTTP admission and current schema."""

from datetime import UTC


import base64
import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from httpx import ASGITransport, AsyncClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ValidationException
from app.db.models import Score, ScoreInvite, ScoreMembership, User
from app.db.models.score_access import MembershipRole, InviteTerminalOutcome
from app.main import app
from app.modules.score_invites.pagination import encode_cursor, decode_cursor
from app.modules.score_invites.repository import ScoreInviteRepository
from tests.support.postgres_schema import postgres_schema_database
from tests.test_trusted_collaboration import collaboration as collaboration
from tests.test_score_revision_services import score_service_session as score_service_session

NOW = datetime(2026, 1, 1, 12, tzinfo=UTC)


def invite(score_id, index, *, created_at=NOW, **kwargs):
    return ScoreInvite(
        score_id=score_id,
        invite_uuid=f"invite-{index}",
        token_hash=f"{index:064x}",
        created_by_user_id=1,
        email="other@example.com",
        role=MembershipRole.VIEWER,
        created_at=created_at,
        **kwargs,
    )


@pytest.mark.parametrize("kind", ["invites", "members", "pending_invites"])
def test_postgres_collection_continuation_reaches_every_row_with_equal_timestamps(
    monkeypatch, kind
):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as session:
            session.add_all(
                [
                    User(id=1, email="owner@example.com", password_hash="hash"),
                    User(id=2, email="other@example.com", password_hash="hash"),
                ]
            )
            session.flush()
            session.add(
                Score(id=10, score_uuid="pagination-score", owner_user_id=1, title="Pagination")
            )
            session.flush()
            if kind == "members":
                session.add_all(
                    [
                        User(id=i + 10, email=f"member-{i}@example.com", password_hash="hash")
                        for i in range(205)
                    ]
                )
                session.flush()
                rows = [
                    ScoreMembership(
                        score_id=10,
                        user_id=i + 10,
                        created_by_user_id=1,
                        role=MembershipRole.VIEWER,
                        created_at=NOW,
                    )
                    for i in range(205)
                ]
            else:
                rows = [invite(10, i) for i in range(205)]
            session.add_all(rows)
            session.commit()
            expected = sorted([row.id for row in rows], reverse=kind != "members")
            db = session
            repo = ScoreInviteRepository()

            def page(cursor=None):
                if kind == "members":
                    return repo.memberships(db, 10, limit=100, cursor=cursor)
                if kind == "pending_invites":
                    return repo.pending_invites_for_email(
                        db,
                        "other@example.com",
                        user_id=2,
                        now=NOW,
                        limit=100,
                        cursor=cursor,
                    )
                return repo.invites(db, 10, limit=100, cursor=cursor)

            found, cursor = page()
            sizes = [len(found)]
            ids = [row.id for row in found]
            while cursor is not None:
                found, cursor = page(cursor)
                sizes.append(len(found))
                ids.extend(row.id for row in found)
            assert sizes == [100, 100, 5]
            assert ids == expected
            assert len(set(ids)) == 205


def test_invite_continuation_uses_immutable_position_across_mutation_and_insert(
    collaboration,
):
    session, _, _, db = collaboration
    rows = [invite(4000, i, created_at=NOW + timedelta(seconds=i // 2)) for i in range(7)]
    session.add_all(rows)
    session.commit()
    repo = ScoreInviteRepository()
    first, cursor = repo.invites(db, 4000, limit=3)
    assert [row.id for row in first] == [row.id for row in reversed(rows[-3:])]
    expected = [row.id for row in reversed(rows[:-3])]
    # The anchor need not exist, and mutable delivery/access state is not an ordering key.
    session.delete(first[-1])
    first[0].terminal_outcome = InviteTerminalOutcome.REVOKED
    first[0].terminal_at = NOW
    first[0].terminal_actor_user_id = 1
    session.add(invite(4000, 999, created_at=NOW + timedelta(days=1)))
    session.commit()
    remaining, next_cursor = repo.invites(db, 4000, limit=100, cursor=cursor)
    assert [row.id for row in remaining] == expected
    assert next_cursor is None
    fresh, _ = repo.invites(db, 4000, limit=3)
    assert fresh[0].invite_uuid == "invite-999"
    assert not set(expected) & {row.id for row in first}


def test_pending_page_filters_expiry_before_limiting_without_writes(collaboration):
    session, _, _, db = collaboration
    rows = [invite(4000, i, expires_at=NOW - timedelta(seconds=1)) for i in range(205)]
    rows += [
        invite(4000, 300),
        invite(4000, 301, expires_at=NOW + timedelta(seconds=1)),
        invite(4000, 302, expires_at=NOW),
    ]
    rows += [
        invite(
            4000,
            400 + index,
            terminal_outcome=outcome,
            terminal_at=NOW,
            terminal_actor_user_id=2,
            expires_at=NOW + timedelta(days=1),
        )
        for index, outcome in enumerate(InviteTerminalOutcome)
    ]
    session.add_all(rows)
    session.commit()
    original = [(row.terminal_outcome, row.terminal_at, row.terminal_actor_user_id) for row in rows]
    page, cursor = ScoreInviteRepository().pending_invites_for_email(
        db,
        "other@example.com",
        user_id=2,
        now=NOW,
        limit=100,
    )
    assert [row.invite_uuid for row in page] == ["invite-301", "invite-300"]
    assert cursor is None
    assert [
        (row.terminal_outcome, row.terminal_at, row.terminal_actor_user_id) for row in rows
    ] == original
    assert rows[0].terminal_outcome is None
    assert not session.dirty


@pytest.mark.parametrize("kind", ["invites", "members", "pending_invites"])
def test_cursor_round_trip_is_scope_and_collection_bound(kind):
    token = encode_cursor(kind, "10", NOW, 42)
    assert token == encode_cursor(kind, "10", NOW, 42)
    assert decode_cursor(token, kind=kind, scope="10") == (NOW, 42)
    with pytest.raises(ValidationException):
        decode_cursor(token, kind=kind, scope="11")
    other_kind = "members" if kind != "members" else "invites"
    with pytest.raises(ValidationException):
        decode_cursor(token, kind=other_kind, scope="10")


@pytest.mark.parametrize(
    "change",
    [
        {"version": 2},
        {"version": True},
        {"row_id": 0},
        {"row_id": 2**63},
        {"row_id": True},
        {"created_at": "NaN"},
        {"created_at": "2026-01-01T12:00:00+00:00"},
        {"extra": 1},
    ],
)
def test_cursor_payload_validation_fails_closed(change):
    payload = dict(
        version=1,
        kind="invites",
        scope="10",
        created_at=NOW.isoformat(timespec="microseconds"),
        row_id=1,
    )
    payload.update(change)
    token = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    with pytest.raises(ValidationException) as caught:
        decode_cursor(token, kind="invites", scope="10")
    assert caught.value.details["field"] == "cursor"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path", ["/scores/trusted-score/invites", "/scores/trusted-score/members", "/me/invites"]
)
async def test_http_collection_page_and_cursor_validation(collaboration, path):
    session, _, _, db = collaboration
    session.add_all([invite(4000, i) for i in range(3)])
    session.add_all(
        [
            ScoreMembership(
                score_id=4000, user_id=i, role=MembershipRole.VIEWER, created_by_user_id=1
            )
            for i in [1, 2]
        ]
    )
    session.commit()

    def current_user():
        return session.get(User, 2 if path == "/me/invites" else 1)

    def database():
        yield db

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_db] = database
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            first = await client.get("/api/v1" + path, params={"limit": 1})
            assert first.status_code == 200, first.text
            data = first.json()
            assert set(data) == {"items", "next_cursor"}
            assert len(data["items"]) == 1
            assert isinstance(data["next_cursor"], str)
            second = await client.get(
                "/api/v1" + path, params={"limit": 1, "cursor": data["next_cursor"]}
            )
            assert second.status_code == 200
            assert second.json()["items"] != data["items"]
            collection = "pending_invites" if path == "/me/invites" else path.rsplit("/", 1)[-1]
            wrong_version = (
                base64.urlsafe_b64encode(
                    json.dumps(
                        dict(
                            version=2,
                            kind=collection,
                            scope="2" if path == "/me/invites" else "4000",
                            created_at=NOW.isoformat(timespec="microseconds"),
                            row_id=1,
                        )
                    ).encode()
                )
                .decode()
                .rstrip("=")
            )
            for token in [
                wrong_version,
                "not-a-cursor",
                encode_cursor("invites", "4000", NOW, 1),
                encode_cursor("members", "4000", NOW, 1),
            ]:
                # At least the other collection's cursor is rejected by every route.
                if (
                    token == encode_cursor("invites", "4000", NOW, 1)
                    and path.endswith("/invites")
                    and path != "/me/invites"
                ):
                    continue
                if token == encode_cursor("members", "4000", NOW, 1) and path.endswith("/members"):
                    continue
                bad = await client.get("/api/v1" + path, params={"cursor": token})
                assert bad.status_code == 422, bad.text
            assert (await client.get("/api/v1" + path, params={"limit": 101})).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_customer_openapi_collaboration_pages():
    document = json.loads(
        (
            Path(__file__).resolve().parents[1] / "docs/contracts/openapi/customer-api.json"
        ).read_text()
    )
    for path, page in [
        ("/api/v1/scores/{score_id}/invites", "InviteListRead"),
        ("/api/v1/scores/{score_id}/members", "MemberListRead"),
        ("/api/v1/me/invites", "PendingInviteListRead"),
    ]:
        operation = document["paths"][path]["get"]
        assert {p["name"] for p in operation["parameters"]} >= {"limit", "cursor"}
        response = operation["responses"]["200"]["content"]["application/json"]["schema"]
        assert response == {"$ref": f"#/components/schemas/{page}"}
        assert set(document["components"]["schemas"][page]["properties"]) == {
            "items",
            "next_cursor",
        }


@pytest.mark.parametrize("kind", ["invites", "members", "pending_invites"])
def test_collection_chronology_precedes_row_id(collaboration, kind):
    session, _, _, db = collaboration
    repo = ScoreInviteRepository()
    if kind == "members":
        rows = [
            ScoreMembership(
                score_id=4000,
                user_id=user_id,
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
                created_at=NOW + timedelta(days=1 - index),
            )
            for index, user_id in enumerate([1, 2])
        ]
    else:
        rows = [
            invite(4000, index, created_at=NOW + timedelta(days=1 - index)) for index in range(2)
        ]
    session.add_all(rows)
    session.commit()
    if kind == "members":
        first, cursor = repo.memberships(db, 4000, limit=1)
        rows[1].role = MembershipRole.EDITOR
        rows[1].revoked_at = NOW
        session.commit()
        rest, end = repo.memberships(db, 4000, limit=1, cursor=cursor)
        assert first == [rows[1]] and rest == [rows[0]]
    elif kind == "invites":
        first, cursor = repo.invites(db, 4000, limit=1)
        rest, end = repo.invites(db, 4000, limit=1, cursor=cursor)
        assert first == [rows[0]] and rest == [rows[1]]
    else:
        first, cursor = repo.pending_invites_for_email(
            db,
            "other@example.com",
            user_id=2,
            now=NOW,
            limit=1,
        )
        rest, end = repo.pending_invites_for_email(
            db,
            "other@example.com",
            user_id=2,
            now=NOW,
            limit=1,
            cursor=cursor,
        )
        assert first == [rows[0]] and rest == [rows[1]]
    assert end is None
