"""Request-scoped HTTP correlation, established once before application dispatch."""

from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send


from app.shared.request_id import REQUEST_ID_PATTERN
from app.platform.correlation import RequestCorrelation, request_correlation


def request_correlation_id(request: Request) -> str:
    """Consume the ID established at ingress; missing context is a runtime bug."""
    request_id = getattr(request.state, "request_id", None)
    if not isinstance(request_id, str) or not REQUEST_ID_PATTERN.fullmatch(request_id):
        raise RuntimeError("HTTP request correlation has not been established")
    return request_id


class RequestCorrelationMiddleware:
    """Own validation, binding, response headers and cleanup for one HTTP request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get("X-Request-ID")
        request_id = (
            incoming if incoming and REQUEST_ID_PATTERN.fullmatch(incoming) else uuid4().hex
        )
        context = RequestCorrelation(request_id)
        token = request_correlation.set(context)

        async def send_correlated(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            scope.setdefault("state", {})["request_id"] = request_id
            await self.app(scope, receive, send_correlated)
        finally:
            # Detached tasks inherit ContextVar values. Closing the shared request
            # binding also prevents them from retaining ambient HTTP correlation.
            context.active = False
            request_correlation.reset(token)
