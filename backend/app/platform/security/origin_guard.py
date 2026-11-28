"""Pure ASGI browser admission through Fetch Metadata, exact origins and media types."""

from collections.abc import Callable
from urllib.parse import urlsplit
from starlette.types import ASGIApp, Scope, Receive, Send
from starlette.responses import Response

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def normalize_origin(value: str) -> str:
    if not isinstance(value, str) or value != value.strip() or any(c.isspace() for c in value):
        raise ValueError("An explicit HTTP origin is required")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or any(character in value for character in "*?#")
    ):
        raise ValueError("An origin must contain only HTTP scheme, host and optional port")
    host = parsed.hostname.encode("idna").decode("ascii").lower()
    if ":" in host:
        host = "[" + host + "]"
    port = parsed.port
    suffix = (
        f":{port}" if port is not None and port != (443 if parsed.scheme == "https" else 80) else ""
    )
    return f"{parsed.scheme}://{host}{suffix}"


class BrowserOriginGuard:
    def __init__(
        self,
        app: ASGIApp,
        *,
        allowed_origins: frozenset[str],
        multipart_allowed_paths: tuple[str, ...],
        error_response: Callable[[Scope, int], Response],
    ):
        if any(normalize_origin(value) != value for value in allowed_origins):
            raise ValueError("Allowed origins must be normalized")
        if any(not path.startswith("/") or "*" in path for path in multipart_allowed_paths):
            raise ValueError("Multipart admission requires exact absolute paths")
        self.app, self.allowed_origins = app, allowed_origins
        self.multipart_allowed_paths, self.error_response = multipart_allowed_paths, error_response

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"].upper() not in UNSAFE_METHODS:
            await self.app(scope, receive, send)
            return
        headers: dict[bytes, list[bytes]] = {}
        for name, value in scope["headers"]:
            headers.setdefault(name.lower(), []).append(value)
        site, origin = headers.get(b"sec-fetch-site", []), headers.get(b"origin", [])
        rejected = (
            (bool(site) and site != [b"same-origin"])
            or len(origin) > 1
            or (bool(origin) and origin[0].decode("latin-1") not in self.allowed_origins)
            or (not origin and site != [b"same-origin"])
        )
        if rejected:
            await self.error_response(scope, 403)(scope, receive, send)
            return
        lengths, transfers = (
            headers.get(b"content-length", []),
            headers.get(b"transfer-encoding", []),
        )
        if len(lengths) > 1 or (lengths and (not lengths[0].isdigit() or len(lengths[0]) > 20)):
            await self.error_response(scope, 415)(scope, receive, send)
            return
        carries_body = (bool(lengths) and int(lengths[0]) > 0) or bool(transfers)
        if carries_body:
            types = headers.get(b"content-type", [])
            expected = (
                b"multipart/form-data"
                if scope["path"] in self.multipart_allowed_paths
                else b"application/json"
            )
            if len(types) != 1 or types[0].split(b";", 1)[0].strip().lower() != expected:
                await self.error_response(scope, 415)(scope, receive, send)
                return
        await self.app(scope, receive, send)
