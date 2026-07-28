"""Smoke-test score source, derived render/audio assets, external access, and cleanup.

The script avoids the full OMR model by creating a tiny valid MusicXML score
inside the backend pod, then dispatches the existing render/playback outboxes.
It validates the public API surface through HTTP and deletes the smoke score
through the product API.
"""

from __future__ import annotations

import argparse
import base64
import http.cookiejar
import json
import subprocess
import sys
import time
from typing import Any
from urllib import error, parse, request


DEFAULT_EMAIL = "k8s-smoke@example.com"
DEFAULT_PASSWORD = "SmokePass123!"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", required=True, help="Base API URL, for example http://127.0.0.1:18000/api/v1")
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--namespace", default="noteverse-staging")
    parser.add_argument("--backend-deployment", default="noteverse-backend-api")
    parser.add_argument("--worker-deployment", default="noteverse-backend-worker")
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--poll-seconds", type=int, default=5)
    parser.add_argument(
        "--keep-on-failure",
        action="store_true",
        help="Leave the created score in place when the smoke test fails.",
    )
    parser.add_argument(
        "--ensure-user",
        action="store_true",
        help="Create or reset the smoke user inside the backend pod before testing.",
    )
    return parser.parse_args()


def kubectl_exec_python(namespace: str, deployment: str, code: str) -> str:
    encoded = base64.b64encode(code.encode("utf-8")).decode("ascii")
    command = [
        "kubectl",
        "-n",
        namespace,
        "exec",
        f"deploy/{deployment}",
        "--",
        "python",
        "-c",
        f"import base64; exec(base64.b64decode('{encoded}').decode())",
    ]
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return completed.stdout


def ensure_user(namespace: str, deployment: str, email: str, password: str) -> None:
    code = f"""
from sqlalchemy import select
from app.core.security import get_password_hash
from app.db.worker_session import SessionLocal
from app.db.models.user import User
from app.utils.timezone import utc_now_naive

email = {email!r}
password = {password!r}
with SessionLocal() as db:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        now = utc_now_naive()
        user = User(
            email=email,
            display_name="K8s Smoke",
            password_hash=get_password_hash(password),
            is_active=True,
            email_verified_at=now,
            password_changed_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
    else:
        user.password_hash = get_password_hash(password)
        user.is_active = True
        user.email_verified_at = user.email_verified_at or utc_now_naive()
    db.commit()
"""
    kubectl_exec_python(namespace, deployment, code)


def create_and_dispatch_score(namespace: str, deployment: str, email: str) -> dict[str, str]:
    code = f"""
import hashlib
import json
import uuid

from sqlalchemy import select

from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.db.models.playback import PlaybackAssetKind, PlaybackOutbox, PlaybackOutboxStatus
from app.db.models.render_outbox import RenderOutbox, RenderOutboxStatus, RenderTargetType
from app.db.models.score import (
    MetadataStatus,
    RevisionOrigin,
    RevisionSourceFormat,
    Score,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreRevisionSource,
)
from app.db.models.storage_usage import StorageUsageCategory
from app.db.worker_session import SessionLocal
from app.modules.metadata.service import rebuild_metadata_sync
from app.modules.storage_usage.service import storage_usage_service
from app.shared.playback_dispatcher import dispatch_playback_outbox
from app.shared.render_dispatcher import dispatch_render_outbox
from app.storage import file_storage
from app.utils.timezone import utc_now_naive

email = {email!r}
musicxml = b'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>
'''

with SessionLocal() as db:
    user = db.execute(select(User).where(User.email == email)).scalar_one()
    user_id = require_persisted_id(user.id, entity="user")
    now = utc_now_naive()
    score_uuid = str(uuid.uuid4())
    revision_uuid = str(uuid.uuid4())
    content_hash = hashlib.sha256(musicxml).hexdigest()
    storage_key = f"scores/{{score_uuid}}/revisions/{{revision_uuid}}/score.musicxml"
    reservation = storage_usage_service.reserve_sync(
        db,
        user_id=user_id,
        category=StorageUsageCategory.SOURCE,
        bytes_count=len(musicxml),
        reason="k8s_smoke_revision_source",
        object_type="score_revision_source",
    )
    stored = file_storage.put_bytes(
        key=storage_key,
        content=musicxml,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    try:
        score = Score(
            score_uuid=score_uuid,
            owner_user_id=user_id,
            title="K8s Smoke Derived Asset",
            created_at=now,
            updated_at=now,
        )
        db.add(score)
        db.flush()
        score_id = require_persisted_id(score.id, entity="score")
        revision = ScoreRevision(
            revision_uuid=revision_uuid,
            score_id=score_id,
            revision_number=1,
            content_hash=content_hash,
            origin=RevisionOrigin.EDIT,
            created_by_user_id=user_id,
            created_at=now,
        )
        db.add(revision)
        db.flush()
        revision_id = require_persisted_id(revision.id, entity="score revision")
        source_uuid = str(uuid.uuid4())
        db.add(ScoreRevisionSource(
            source_uuid=source_uuid,
            revision_id=revision_id,
            format=RevisionSourceFormat.MUSICXML,
            storage_backend=file_storage.backend_name,
            storage_key=stored.storage_key,
            filename=stored.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            size_bytes=stored.size_bytes,
            sha256=content_hash,
            generator="k8s-smoke",
            generator_version="1",
            created_at=now,
        ))
        db.add(ScoreRevisionMetadata(
            revision_id=revision_id,
            status=MetadataStatus.PENDING,
            extractor_version="pending",
        ))
        render_outbox = RenderOutbox(
            outbox_uuid=str(uuid.uuid4()),
            target_type=RenderTargetType.SCORE_REVISION,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=user_id,
            source_fingerprint=content_hash,
            render_profile="default",
            status=RenderOutboxStatus.PENDING,
        )
        playback_outbox = PlaybackOutbox(
            outbox_uuid=str(uuid.uuid4()),
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=user_id,
            source_fingerprint=content_hash,
            asset_kind=PlaybackAssetKind.AUDIO,
            status=PlaybackOutboxStatus.PENDING,
        )
        db.add(render_outbox)
        db.add(playback_outbox)
        score.head_revision_id = revision_id
        db.commit()
        storage_usage_service.commit_reservation_sync(
            db,
            reservation.reservation_id,
            object_type="score_revision_source",
            object_id=source_uuid,
            storage_key=stored.storage_key,
        )
        try:
            rebuild_metadata_sync(db, revision_id, file_storage)
        except Exception:
            db.rollback()
        dispatch_render_outbox(render_outbox.outbox_uuid)
        dispatch_playback_outbox(playback_outbox.outbox_uuid)
        print(json.dumps({{
            "score_id": score_uuid,
            "revision_id": revision_uuid,
            "render_outbox_id": render_outbox.outbox_uuid,
            "playback_outbox_id": playback_outbox.outbox_uuid,
        }}))
    except Exception:
        db.rollback()
        file_storage.delete(stored.storage_key)
        storage_usage_service.release_reservation_sync(db, reservation.reservation_id)
        raise
"""
    stdout = kubectl_exec_python(namespace, deployment, code)
    last_json = stdout.strip().splitlines()[-1]
    return dict(json.loads(last_json))


class HttpError(RuntimeError):
    def __init__(self, method: str, url: str, status_code: int, body: str) -> None:
        super().__init__(f"{method} {url} failed with HTTP {status_code}: {body}")
        self.status_code = status_code
        self.body = body


def csrf_headers(cookie_jar: http.cookiejar.CookieJar) -> dict[str, str]:
    token = next((cookie.value for cookie in cookie_jar if cookie.name == "noteverse_csrf"), None)
    return {"x-csrf-token": token, "content-type": "application/json"} if token else {"content-type": "application/json"}


def request_json(
    opener: request.OpenerDirector,
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    req = request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with opener.open(req, timeout=timeout) as response:
            return dict(json.loads(response.read().decode("utf-8")))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise HttpError(method, url, exc.code, body) from exc


def request_status(
    opener: request.OpenerDirector,
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> int:
    req = request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with opener.open(req, timeout=timeout) as response:
            return int(response.status)
    except error.HTTPError as exc:
        return exc.code


def encode_form(data: dict[str, str]) -> tuple[bytes, dict[str, str]]:
    body = parse.urlencode(data).encode("utf-8")
    return body, {"Content-Type": "application/x-www-form-urlencoded"}


def login(api_base: str, email: str, password: str) -> tuple[request.OpenerDirector, http.cookiejar.CookieJar]:
    cookie_jar = http.cookiejar.CookieJar()
    opener = request.build_opener(request.HTTPCookieProcessor(cookie_jar))
    body, headers = encode_form({"username": email, "password": password})
    request_json(
        opener,
        f"{api_base}/auth/login",
        method="POST",
        data=body,
        headers=headers,
        timeout=30,
    )
    return opener, cookie_jar


def get_score(opener: request.OpenerDirector, api_base: str, score_id: str) -> dict[str, Any]:
    response = request_json(opener, f"{api_base}/scores/{score_id}", timeout=30)
    return dict(response["data"])


def wait_for_assets(
    opener: request.OpenerDirector,
    api_base: str,
    score_id: str,
    *,
    timeout_seconds: int,
    poll_seconds: int,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_score: dict[str, Any] | None = None
    last_error: str | None = None
    while time.monotonic() < deadline:
        try:
            last_score = get_score(opener, api_base, score_id)
            assets = last_score["derived_assets"]
            if assets["preview"]["status"] == "ready" and assets["audio"]["status"] == "ready":
                return last_score
        except (error.HTTPError, error.URLError, TimeoutError) as exc:
            last_error = str(exc)
        time.sleep(poll_seconds)
    raise TimeoutError(f"Timed out waiting for derived assets: last_score={last_score}; last_error={last_error}")


def assert_external_access(
    api_base: str,
    opener: request.OpenerDirector,
    cookie_jar: http.cookiejar.CookieJar,
    score: dict[str, Any],
) -> dict[str, str]:
    score_id = str(score["score_id"])
    revision_id = str(score["head_revision_id"])
    headers = csrf_headers(cookie_jar)
    grant = request_json(
        opener,
        f"{api_base}/scores/{score_id}/grants",
        method="POST",
        data=json.dumps({"allow_download": False, "allow_practice": True, "expires_at": None}).encode("utf-8"),
        headers=headers,
        timeout=30,
    )
    token = grant["data"]["token"]

    slug = f"k8s-smoke-{score_id[:8]}"
    request_json(
        opener,
        f"{api_base}/scores/{score_id}/publication",
        method="PUT",
        data=json.dumps({
            "revision_id": revision_id,
            "public_slug": slug,
            "allow_download": False,
            "allow_practice": True,
        }).encode("utf-8"),
        headers=headers,
        timeout=30,
    )

    anonymous = request.build_opener()
    share_data = request_json(anonymous, f"{api_base}/score-grants/{token}", timeout=30)["data"]
    public_data = request_json(anonymous, f"{api_base}/publications/{slug}", timeout=30)["data"]
    for label, payload in (("share", share_data), ("public", public_data)):
        assets = payload["derived_assets"]
        if assets["preview"]["status"] != "ready" or assets["audio"]["status"] != "ready":
            raise AssertionError(f"{label} derived assets are not ready: {assets}")
        if payload["capabilities"]["can_download"]:
            raise AssertionError(f"{label} can_download leaked as true")
        sources = payload["revision_assets"].get("revision_sources") or []
        if sources:
            raise AssertionError(f"{label} exposed revision sources when downloads are disabled")

    for url in (
        f"{api_base}/score-grants/{token}/playback",
        f"{api_base}/publications/{slug}/playback",
    ):
        status_code = request_status(anonymous, url, timeout=30)
        if status_code not in {200, 302, 307}:
            raise AssertionError(f"Playback endpoint failed: {url} -> {status_code}")
    return {"share_token": token, "public_slug": slug}


def delete_score(
    opener: request.OpenerDirector,
    cookie_jar: http.cookiejar.CookieJar,
    api_base: str,
    score_id: str,
) -> None:
    response = request_json(
        opener,
        f"{api_base}/scores/batch-delete",
        method="POST",
        data=json.dumps({"score_ids": [score_id]}).encode("utf-8"),
        headers=csrf_headers(cookie_jar),
        timeout=30,
    )
    removed = response["data"]["removed"]
    if removed != 1:
        raise AssertionError(f"Expected one score to be deleted, got {removed}")


def trigger_cleanup(namespace: str, deployment: str) -> None:
    code = "from app.worker.tasks import run_score_deletion_cleanup; print(run_score_deletion_cleanup())"
    kubectl_exec_python(namespace, deployment, code)


def assert_owner_usage_zero(namespace: str, deployment: str, email: str) -> None:
    code = f"""
from sqlalchemy import select
from app.db.models.storage_usage import StorageUsageCounter
from app.db.models.user import User
from app.db.worker_session import SessionLocal

email = {email!r}
with SessionLocal() as db:
    user = db.execute(select(User).where(User.email == email)).scalar_one()
    counters = db.execute(
        select(StorageUsageCounter.category, StorageUsageCounter.used_bytes)
        .where(StorageUsageCounter.user_id == user.id)
    ).all()
    non_zero = [
        (category.value, used_bytes)
        for category, used_bytes in counters
        if used_bytes
    ]
    if non_zero:
        raise SystemExit(f"Storage usage not released: {{non_zero}}")
"""
    kubectl_exec_python(namespace, deployment, code)


def cleanup_score(
    opener: request.OpenerDirector,
    cookie_jar: http.cookiejar.CookieJar,
    api_base: str,
    namespace: str,
    worker_deployment: str,
    score_id: str,
) -> None:
    try:
        delete_score(opener, cookie_jar, api_base, score_id)
    except HttpError as exc:
        if exc.status_code not in {404, 410, 422}:
            raise
    trigger_cleanup(namespace, worker_deployment)


def main() -> int:
    args = parse_args()
    if args.ensure_user:
        ensure_user(args.namespace, args.backend_deployment, args.email, args.password)

    opener, cookie_jar = login(args.api_base, args.email, args.password)
    created = create_and_dispatch_score(args.namespace, args.backend_deployment, args.email)
    score_id = created["score_id"]
    try:
        score = wait_for_assets(
            opener,
            args.api_base,
            score_id,
            timeout_seconds=args.timeout_seconds,
            poll_seconds=args.poll_seconds,
        )
        external = assert_external_access(args.api_base, opener, cookie_jar, score)
        cleanup_score(opener, cookie_jar, args.api_base, args.namespace, args.worker_deployment, score_id)
        assert_owner_usage_zero(args.namespace, args.backend_deployment, args.email)
    except Exception:
        print(json.dumps({"score_id": score_id, "created": created}, indent=2), file=sys.stderr)
        if not args.keep_on_failure:
            try:
                cleanup_score(opener, cookie_jar, args.api_base, args.namespace, args.worker_deployment, score_id)
                assert_owner_usage_zero(args.namespace, args.backend_deployment, args.email)
            except Exception as cleanup_error:
                print(f"cleanup failed: {cleanup_error}", file=sys.stderr)
        raise

    print(json.dumps({"score_id": score_id, **created, **external, "cleanup": "released"}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
