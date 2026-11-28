"""Control Plane authentication and operator-management HTTP representations."""

from typing import Annotated
from pydantic import BaseModel, EmailStr, Field, BeforeValidator, ConfigDict
from app.platform.security.passwords import validate_password, normalize_password
from app.modules.platform_operators.domain import OperatorRole, OperatorStatus, ChallengePurpose
from app.modules.platform_operators.permissions import OperatorPermission, ROLE_PERMISSIONS
from app.modules.ops.schemas import ReasonCommand
from app.shared.time import Instant

Password = Annotated[str, BeforeValidator(validate_password)]


class OperatorLoginCommand(BaseModel):
    email: EmailStr
    password: Annotated[str, BeforeValidator(normalize_password)] = Field(
        min_length=1, max_length=128
    )


class OperatorRead(BaseModel):
    operator_id: str
    email: EmailStr
    display_name: str
    role: OperatorRole
    status: OperatorStatus
    permissions: list[OperatorPermission]
    totp_enabled: bool


class MfaChallengeRead(BaseModel):
    purpose: ChallengePurpose
    expires_at: Instant


class TotpEnrollmentRead(BaseModel):
    secret: str
    otpauth_uri: str


class TotpCodeCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(pattern=r"^[0-9]{6}$")


class RecoveryCodeCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recovery_code: str = Field(pattern=r"^[A-Fa-f0-9]{5}(-[A-Fa-f0-9]{5}){3}$")


class MfaEnrollmentRead(BaseModel):
    operator: OperatorRead
    recovery_codes: list[str]


class MfaVerifiedRead(BaseModel):
    operator: OperatorRead
    recovery_codes_remaining: int


class CreateOperatorCommand(ReasonCommand):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=128)
    password: Password = Field(min_length=12, max_length=128)
    role: OperatorRole


class UpdateOperatorCommand(ReasonCommand):
    role: OperatorRole
    status: OperatorStatus


class ResetOperatorPasswordCommand(ReasonCommand):
    password: Password = Field(min_length=12, max_length=128)


class CustomerStatusCommand(ReasonCommand):
    is_active: bool


class CustomerDirectoryRead(BaseModel):
    user_id: int
    email: str
    display_name: str | None
    is_active: bool


def operator_read(operator) -> OperatorRead:
    return OperatorRead(
        operator_id=operator.operator_uuid,
        email=operator.email,
        display_name=operator.display_name,
        role=operator.role,
        status=operator.status,
        permissions=sorted(ROLE_PERMISSIONS[operator.role]),
        totp_enabled=operator.totp_enabled_at is not None,
    )
