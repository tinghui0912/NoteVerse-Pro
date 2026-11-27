"""HTTP runtime abuse policies are explicit, typed and independently configurable."""

from typing import Literal
from pydantic import BaseModel, Field


class AuthenticationRatePolicy(BaseModel):
    ip_limit: int = Field(gt=0)
    identity_limit: int = Field(gt=0)
    window_seconds: int = Field(gt=0)
    failure_mode: Literal["fail_closed"] = "fail_closed"


class MutationRatePolicy(BaseModel):
    limit: int = Field(gt=0)
    window_seconds: int = Field(gt=0)
    failure_mode: Literal["fail_closed", "fail_open"] = "fail_open"


class RateLimitConnectionSettings(BaseModel):
    RATE_LIMIT_NAMESPACE: str = Field(default="noteverse", pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    RATE_LIMIT_REDIS_TIMEOUT_SECONDS: float = Field(default=0.25, gt=0, le=5)


class CustomerRateLimitSettings(RateLimitConnectionSettings):
    CUSTOMER_LOGIN_RATE_LIMIT: AuthenticationRatePolicy = AuthenticationRatePolicy(
        ip_limit=30, identity_limit=10, window_seconds=300
    )
    CUSTOMER_REGISTRATION_RATE_LIMIT: AuthenticationRatePolicy = AuthenticationRatePolicy(
        ip_limit=10, identity_limit=3, window_seconds=3600
    )
    CUSTOMER_RECOVERY_RATE_LIMIT: AuthenticationRatePolicy = AuthenticationRatePolicy(
        ip_limit=20, identity_limit=5, window_seconds=3600
    )
    CUSTOMER_UPLOAD_RATE_LIMIT: MutationRatePolicy = MutationRatePolicy(limit=20, window_seconds=60)
    CUSTOMER_REVISION_RATE_LIMIT: MutationRatePolicy = MutationRatePolicy(
        limit=60, window_seconds=60
    )


class OperatorRateLimitSettings(RateLimitConnectionSettings):
    OPERATOR_LOGIN_RATE_LIMIT: AuthenticationRatePolicy = AuthenticationRatePolicy(
        ip_limit=10, identity_limit=5, window_seconds=300
    )
    OPERATOR_MFA_RATE_LIMIT: AuthenticationRatePolicy = AuthenticationRatePolicy(
        ip_limit=30, identity_limit=5, window_seconds=300
    )
    OPERATOR_MFA_IDENTITY_LIMIT: int = Field(default=10, gt=0)
