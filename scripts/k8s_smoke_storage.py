"""Smoke-test API upload storage and storage-usage accounting.

This script is intended for local minikube or staging preflight checks. It uses
the real HTTP API for auth, upload, quota read, and delete. Optionally it can
create or reset the smoke user inside the backend pod before running.
"""

from __future__ import annotations

import argparse
import base64
import http.cookiejar
import json
import mimetypes
import subprocess
import sys
from pathlib import Path
from urllib import error, parse, request


DEFAULT_EMAIL = "k8s-smoke@example.com"
DEFAULT_PASSWORD = "SmokePass123!"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", required=True, help="Base API URL, for example http://127.0.0.1:18000/api/v1")
    parser.add_argument("--image", default="apps/customer-web/public/images/placeholders/score-example.jpg")
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--namespace", default="noteverse-staging")
    parser.add_argument("--backend-deployment", default="noteverse-backend-api")
    parser.add_argument(
        "--ensure-user",
        action="store_true",
        help="Create or reset the smoke user inside the backend pod before testing.",
    )
    return parser.parse_args()


def kubectl_exec_python(namespace: str, deployment: str, code: str) -> None:
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
    subprocess.run(command, check=True)


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


def csrf_headers(cookie_jar: http.cookiejar.CookieJar) -> dict[str, str]:
    token = next((cookie.value for cookie in cookie_jar if cookie.name == "noteverse_csrf"), None)
    return {"x-csrf-token": token} if token else {}


def request_json(
    opener: request.OpenerDirector,
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> dict[str, object]:
    req = request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with opener.open(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {body}") from exc


def encode_form(data: dict[str, str]) -> tuple[bytes, dict[str, str]]:
    body = parse.urlencode(data).encode("utf-8")
    return body, {"Content-Type": "application/x-www-form-urlencoded"}


def encode_multipart_file(field_name: str, file_path: Path) -> tuple[bytes, dict[str, str]]:
    boundary = "noteverse-smoke-boundary"
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            (
                f'Content-Disposition: form-data; name="{field_name}"; '
                f'filename="{file_path.name}"\r\n'
            ).encode("utf-8"),
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
            file_path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    return body, {"Content-Type": f"multipart/form-data; boundary={boundary}"}


def quota_used(opener: request.OpenerDirector, api_base: str) -> int:
    response = request_json(opener, f"{api_base}/me/storage-usage")
    return int(response["data"]["quota"]["used_bytes"])  # type: ignore[index]


def main() -> int:
    args = parse_args()
    image_path = Path(args.image)
    if not image_path.is_file():
        print(f"Image not found: {image_path}", file=sys.stderr)
        return 2

    if args.ensure_user:
        ensure_user(args.namespace, args.backend_deployment, args.email, args.password)

    cookie_jar = http.cookiejar.CookieJar()
    opener = request.build_opener(request.HTTPCookieProcessor(cookie_jar))
    login_body, login_headers = encode_form({"username": args.email, "password": args.password})
    request_json(
        opener,
        f"{args.api_base}/auth/login",
        method="POST",
        data=login_body,
        headers=login_headers,
    )
    headers = csrf_headers(cookie_jar)

    before = quota_used(opener, args.api_base)
    upload_body, upload_headers = encode_multipart_file("file", image_path)
    upload_headers.update(headers)
    uploaded = request_json(
        opener,
        f"{args.api_base}/files/upload",
        method="POST",
        data=upload_body,
        headers=upload_headers,
        timeout=60,
    )
    file_id = uploaded["data"]["file_id"]  # type: ignore[index]
    after_upload = quota_used(opener, args.api_base)

    request_json(
        opener,
        f"{args.api_base}/files/{file_id}",
        method="DELETE",
        headers=headers,
        timeout=60,
    )
    after_delete = quota_used(opener, args.api_base)

    result = {
        "file_id": file_id,
        "upload_delta": after_upload - before,
        "delete_delta": after_delete - before,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    if result["upload_delta"] <= 0 or result["delete_delta"] != 0:
        print("S3 upload quota smoke failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
