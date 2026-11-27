"""Consumer admission policies bind stable identities to distributed windows."""

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
from app.db.models import User
from app.db.models.auth import AuthToken, PendingRegistration, EmailChangeRequest
from app.runtime.browser_security import (
    get_rate_limiter,
    authentication_buckets,
    enforce,
    json_command_fields,
)
from app.runtime.customer_api.deps import get_current_user


def limit_login(
    request: Request,
    body: dict[str, object] = Depends(json_command_fields),
    limiter: RedisSlidingWindowLimiter = Depends(get_rate_limiter),
) -> None:
    policy = request.app.state.settings.CUSTOMER_LOGIN_RATE_LIMIT
    enforce(
        limiter,
        "login",
        authentication_buckets(
            request,
            policy,
            dimension="email",
            identity=normalized_email_digest(str(body.get("email", ""))),
        ),
        failure_mode=policy.failure_mode,
    )


def limit_registration(
    request: Request,
    body: dict[str, object] = Depends(json_command_fields),
    limiter: RedisSlidingWindowLimiter = Depends(get_rate_limiter),
) -> None:
    policy = request.app.state.settings.CUSTOMER_REGISTRATION_RATE_LIMIT
    enforce(
        limiter,
        "register",
        authentication_buckets(
            request,
            policy,
            dimension="email",
            identity=normalized_email_digest(str(body.get("email", ""))),
        ),
        failure_mode=policy.failure_mode,
    )


def limit_recovery(
    request: Request,
    body: dict[str, object] = Depends(json_command_fields),
    db: Session = Depends(get_db, scope="function"),
    limiter: RedisSlidingWindowLimiter = Depends(get_rate_limiter),
) -> None:
    policy = request.app.state.settings.CUSTOMER_RECOVERY_RATE_LIMIT
    path = request.url.path
    email: object = None
    token = token_digest(str(body.get("token", "")))
    if path.endswith(("/password/reset", "/email/verify", "/email/change/confirm")):
        if path.endswith("/email/verify"):
            email = db.execute(
                select(PendingRegistration.email).where(PendingRegistration.token_hash == token)
            ).scalar_one_or_none()
        elif path.endswith("/email/change/confirm"):
            email = db.execute(
                select(EmailChangeRequest.new_email).where(EmailChangeRequest.token_hash == token)
            ).scalar_one_or_none()
        else:
            email = db.execute(
                select(User.email)
                .join(AuthToken, AuthToken.user_id == User.id)
                .where(AuthToken.token_hash == token)
            ).scalar_one_or_none()
    elif path.endswith("/me/email/change"):
        email = body.get("new_email")
    else:
        email = body.get("email")
    dimension, identity = (
        ("email", normalized_email_digest(email))
        if isinstance(email, str) and email
        else ("token", token)
    )
    # Shared recovery windows bound issuance and consumption for a normalized mailbox.
    enforce(
        limiter,
        "recovery",
        authentication_buckets(request, policy, dimension=dimension, identity=identity),
        failure_mode=policy.failure_mode,
    )


def limit_upload(
    request: Request,
    user: User = Depends(get_current_user),
    limiter: RedisSlidingWindowLimiter = Depends(get_rate_limiter),
) -> None:
    policy = request.app.state.settings.CUSTOMER_UPLOAD_RATE_LIMIT
    enforce(
        limiter,
        "upload",
        (RateLimitBucket("user", str(user.id), policy.limit, policy.window_seconds),),
        failure_mode=policy.failure_mode,
    )


def limit_revision(
    request: Request,
    user: User = Depends(get_current_user),
    limiter: RedisSlidingWindowLimiter = Depends(get_rate_limiter),
) -> None:
    policy = request.app.state.settings.CUSTOMER_REVISION_RATE_LIMIT
    enforce(
        limiter,
        "revision",
        (RateLimitBucket("user", str(user.id), policy.limit, policy.window_seconds),),
        failure_mode=policy.failure_mode,
    )
