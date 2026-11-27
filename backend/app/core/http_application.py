"""FastAPI HTTP ingress with correlation outside the complete framework stack."""

from fastapi import FastAPI
from starlette.types import Receive, Scope, Send

from app.core.request_correlation import RequestCorrelationMiddleware


class HttpApplication(FastAPI):
    """Keep correlation active across middleware, tracing and server-error handling."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await RequestCorrelationMiddleware(super().__call__)(scope, receive, send)
