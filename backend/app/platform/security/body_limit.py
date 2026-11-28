"""Pure ASGI ingress byte ceilings before downstream JSON or multipart buffering."""

from collections.abc import Callable
from dataclasses import dataclass
import re
from typing import Literal

from starlette.responses import Response
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send


@dataclass(frozen=True)
class PathBodyLimitRule:
    path: str
    max_bytes: int
    match: Literal["exact", "prefix", "regex"] = "exact"

    def __post_init__(self) -> None:
        if self.max_bytes <= 0 or not self.path.startswith(("/", "^/")):
            raise ValueError("Body limits require a positive budget and absolute path")
        if self.match not in {"exact", "prefix", "regex"}:
            raise ValueError("Unsupported body limit match")
        if self.match == "regex":
            re.compile(self.path)

    def matches(self, path: str) -> bool:
        if self.match == "regex":
            return re.fullmatch(self.path, path) is not None
        if self.match == "prefix":
            return path == self.path or path.startswith(self.path.rstrip("/") + "/")
        return path == self.path


class _BodyTooLarge(HTTPException):
    def __init__(self) -> None:
        super().__init__(413)


class RequestBodyLimit:
    def __init__(
        self,
        app: ASGIApp,
        *,
        default_max_bytes: int,
        path_limits: tuple[PathBodyLimitRule, ...] = (),
        error_response: Callable[[Scope, int], Response],
    ) -> None:
        if default_max_bytes <= 0:
            raise ValueError("The default request budget must be positive")
        self.app, self.default_max_bytes = app, default_max_bytes
        self.path_limits, self.error_response = path_limits, error_response

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = next(
            (r.max_bytes for r in self.path_limits if r.matches(scope["path"])),
            self.default_max_bytes,
        )
        lengths = [value for name, value in scope["headers"] if name.lower() == b"content-length"]
        invalid = len(lengths) > 1 or (
            lengths and (not lengths[0].isdigit() or len(lengths[0]) > 20)
        )
        if invalid or (lengths and int(lengths[0]) > limit):
            await self.error_response(scope, 400 if invalid else 413)(scope, receive, send)
            return
        received = 0
        exceeded = replied = started = False

        async def bounded_receive() -> Message:
            nonlocal received, exceeded
            if exceeded:
                raise _BodyTooLarge()
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _BodyTooLarge()
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal replied, started
            if exceeded:
                if not replied:
                    if started:
                        raise _BodyTooLarge()
                    replied = True
                    await self.error_response(scope, 413)(scope, receive, send)
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, bounded_receive, guarded_send)
        except Exception:
            if not exceeded or started:
                raise
        if exceeded and not replied:
            await self.error_response(scope, 413)(scope, receive, send)
