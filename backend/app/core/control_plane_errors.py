"""Control-plane failure presentation, selected by its composition root."""


def control_plane_error_response(code: str, request_id: str | None) -> dict[str, object]:
    payload: dict[str, object] = {
        "success": False,
        "public_code": code,
        "public_message": code,
    }
    if request_id:
        payload["request_id"] = request_id
    return payload
