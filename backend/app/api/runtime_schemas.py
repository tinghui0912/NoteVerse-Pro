"""Customer process endpoint response contracts."""

from typing import Literal
from typing_extensions import TypedDict


class RootRead(TypedDict):
    message: str
    version: str
    docs: str
    status: Literal["operational"]


class LivenessRead(TypedDict):
    status: Literal["ok"]


class ReadinessRead(TypedDict):
    status: Literal["ok", "degraded"]
    checks: dict[str, Literal["ok", "failed", "degraded"]]


class ReadinessUnavailableRead(TypedDict):
    status: Literal["not_ready"]
    checks: dict[str, Literal["ok", "failed", "degraded"]]
