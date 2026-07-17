"""Smoke-test API upload storage and storage-usage accounting.

This script is intended for local minikube or staging preflight checks. It uses
the real HTTP API for auth, upload, quota read, and delete. Optionally it can
create or reset the smoke user inside the backend pod before running.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

import requests


DEFAULT_EMAIL = "k8s-smoke@example.com"
DEFAULT_PASSWORD = "SmokePass123!"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", required=True, help="Base API URL, for example http://127.0.0.1:18000/api/v1")
    parser.add_argument("--image", default="frontend/public/images/placeholders/score-example.jpg")
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


def csrf_headers(session: requests.Session) -> dict[str, str]:
    token = session.cookies.get("noteverse_csrf")
    return {"x-csrf-token": token} if token else {}


def quota_used(session: requests.Session, api_base: str) -> int:
    response = session.get(f"{api_base}/me/storage-usage", timeout=30)
    response.raise_for_status()
    return int(response.json()["data"]["quota"]["used_bytes"])


def main() -> int:
    args = parse_args()
    image_path = Path(args.image)
    if not image_path.is_file():
        print(f"Image not found: {image_path}", file=sys.stderr)
        return 2

    if args.ensure_user:
        ensure_user(args.namespace, args.backend_deployment, args.email, args.password)

    session = requests.Session()
    login = session.post(
        f"{args.api_base}/auth/login",
        data={"username": args.email, "password": args.password},
        timeout=30,
    )
    login.raise_for_status()
    headers = csrf_headers(session)

    before = quota_used(session, args.api_base)
    with image_path.open("rb") as handle:
        uploaded = session.post(
            f"{args.api_base}/files/upload",
            files={"file": (image_path.name, handle, "image/jpeg")},
            headers=headers,
            timeout=60,
        )
    uploaded.raise_for_status()
    file_id = uploaded.json()["data"]["file_id"]
    after_upload = quota_used(session, args.api_base)

    deleted = session.delete(f"{args.api_base}/files/{file_id}", headers=headers, timeout=60)
    deleted.raise_for_status()
    after_delete = quota_used(session, args.api_base)

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
