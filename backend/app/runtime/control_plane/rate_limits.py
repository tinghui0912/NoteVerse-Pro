"""Operator password and MFA admission is fail-closed through Redis."""

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.platform.db.dependencies import get_db
from app.platform.security.opaque_tokens import token_digest
from app.platform.security.rate_limit import (
    RedisSlidingWindowLimiter,
    RateLimitBucket,
    normalized_email_digest,
)
from app.db.models.operator import OperatorMfaChallenge
from app.runtime.browser_security import (
    get_rate_limiter,
    authentication_buckets,
    enforce,
    json_command_fields,
)


def limit_login(
    request: Request,
    body: dict[str, object] = Depends(json_command_fields),
    limiter: RedisSlidingWindowLimiter = Depends(get_rate_limiter),
) -> None:
    email = str(body.get("email", ""))
    policy = request.app.state.settings.OPERATOR_LOGIN_RATE_LIMIT
    enforce(
        limiter,
        "login",
        authentication_buckets(
            request, policy, dimension="email", identity=normalized_email_digest(email)
        ),
        failure_mode=policy.failure_mode,
    )


def limit_mfa(
    request: Request,
    db: Session = Depends(get_db, scope="function"),
    limiter: RedisSlidingWindowLimiter = Depends(get_rate_limiter),
) -> None:
    config = request.app.state.settings
    policy = config.OPERATOR_MFA_RATE_LIMIT
    raw = request.cookies.get(config.to_security_settings().challenge_cookie_name, "")
    digest = token_digest(raw)
    buckets = list(authentication_buckets(request, policy, dimension="challenge", identity=digest))
    operator_id = db.execute(
        select(OperatorMfaChallenge.operator_id).where(OperatorMfaChallenge.token_hash == digest)
    ).scalar_one_or_none()
    if operator_id is not None:
        buckets.append(
            RateLimitBucket(
                "operator",
                str(operator_id),
                config.OPERATOR_MFA_IDENTITY_LIMIT,
                policy.window_seconds,
            )
        )
    enforce(limiter, "mfa", buckets, failure_mode=policy.failure_mode)
