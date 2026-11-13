"""OpenAPI descriptions for responses that deliver stored bytes unchanged."""

from typing import Any


def binary_responses(
    *media_types: str, byte_ranges: bool = False
) -> dict[int | str, dict[str, Any]]:
    """Describe the delivered Content-Type range without implying JSON decoding."""
    content = {
        media_type: {"schema": {"type": "string", "format": "binary"}} for media_type in media_types
    }
    responses: dict[int | str, dict[str, Any]] = {
        200: {
            "description": "Stored bytes; Content-Type identifies the selected resource format.",
            "content": content,
        }
    }
    if byte_ranges:
        responses[206] = {
            "description": "Requested byte range of the stored media.",
            "content": content,
            "headers": {
                "Content-Range": {"schema": {"type": "string"}},
                "Accept-Ranges": {"schema": {"type": "string", "enum": ["bytes"]}},
            },
        }
    return responses
