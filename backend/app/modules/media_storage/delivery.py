"""Authorized delivery policy, immutable caching and provider capability issuance."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from app.storage import ObjectStorage


class DeliveryMode(StrEnum):
    SIGNED_REDIRECT = "SIGNED_REDIRECT"
    CONTROLLED_STREAM = "CONTROLLED_STREAM"


class DeliveryTarget(Protocol):
    @property
    def storage_key(self) -> str: ...
    @property
    def byte_size(self) -> int: ...
    @property
    def media_type(self) -> str: ...
    @property
    def filename(self) -> str: ...


@dataclass(frozen=True)
class DeliveryPolicy:
    signed_url_ttl_seconds: int
    immutable_cache_seconds: int
    max_stream_media_bytes: int

    def __post_init__(self) -> None:
        if (
            min(
                self.signed_url_ttl_seconds,
                self.immutable_cache_seconds,
                self.max_stream_media_bytes,
            )
            <= 0
        ):
            raise ValueError("Delivery limits must be positive")


@dataclass(frozen=True)
class MediaDelivery:
    mode: DeliveryMode
    location: str | None
    cache_control: str


@dataclass(frozen=True)
class SystemObjectDelivery:
    """A deployment-owned immutable object authorized by its manifest domain."""

    storage_key: str
    byte_size: int
    media_type: str
    filename: str


class MediaDeliveryService:
    """Business authorization precedes delivery; provider keys remain internal inputs."""

    def __init__(self, storage: ObjectStorage, policy: DeliveryPolicy) -> None:
        self.storage = storage
        self.policy = policy

    def deliver(
        self,
        target: DeliveryTarget,
        *,
        mode: DeliveryMode = DeliveryMode.SIGNED_REDIRECT,
        attachment: bool = False,
        public: bool = False,
    ) -> MediaDelivery:
        if mode == DeliveryMode.CONTROLLED_STREAM:
            if (
                target.media_type.startswith(("audio/", "video/"))
                and target.byte_size > self.policy.max_stream_media_bytes
            ):
                raise ValueError("Large media requires signed provider delivery")
            return MediaDelivery(mode, None, "private, no-store")
        cache_seconds = min(self.policy.immutable_cache_seconds, self.policy.signed_url_ttl_seconds)
        return MediaDelivery(
            mode,
            self.signed_url(target, attachment=attachment),
            f"{'public' if public else 'private'}, max-age={cache_seconds}, immutable",
        )

    def signed_url(
        self,
        target: DeliveryTarget,
        *,
        attachment: bool = False,
        expires_seconds: int | None = None,
    ) -> str:
        return self.storage.download_url(
            target.storage_key,
            filename=target.filename if attachment else None,
            content_type=target.media_type,
            expires_seconds=expires_seconds
            if expires_seconds is not None
            else self.policy.signed_url_ttl_seconds,
        )
