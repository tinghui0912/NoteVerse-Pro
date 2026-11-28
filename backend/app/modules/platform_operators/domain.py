"""Operator identity lifecycle and MFA challenge state taxonomies."""

from enum import StrEnum


class OperatorRole(StrEnum):
    SUPPORT_READONLY = "SUPPORT_READONLY"
    PLATFORM_OPERATOR = "PLATFORM_OPERATOR"
    SUPER_ADMIN = "SUPER_ADMIN"


class OperatorStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class ChallengePurpose(StrEnum):
    ENROLLMENT_REQUIRED = "ENROLLMENT_REQUIRED"
    VERIFICATION_REQUIRED = "VERIFICATION_REQUIRED"
