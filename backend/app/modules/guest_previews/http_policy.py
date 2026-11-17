"""Non-cacheable HTTP boundary for Guest Preview capabilities and owner settings."""

from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.exception_handlers import general_exception_handler


class GuestPreviewCachePolicyMiddleware:
    def __init__(self, app: ASGIApp, *, api_prefix: str) -> None:
        self.app = app
        self.api_prefix = api_prefix + "/"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        parts = path.removeprefix(self.api_prefix).rstrip("/").split("/")
        if (
            scope["type"] != "http"
            or not path.startswith(self.api_prefix)
            or not (
                parts[0] == "guest-previews"
                or (len(parts) >= 3 and parts[0] == "scores" and parts[2] == "guest-preview")
            )
        ):
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_private(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "private, no-store"
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_private)
        except Exception as exc:
            # Starlette's outer ServerErrorMiddleware cannot pass its response back
            # through user middleware. Render the existing 500 envelope here so it
            # crosses the same send boundary; never replace an in-flight stream.
            if response_started:
                raise
            response = await general_exception_handler(Request(scope), exc)
            await response(scope, receive, send_private)
