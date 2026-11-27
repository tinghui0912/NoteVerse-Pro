from enum import StrEnum

from app.shared.error_codes import CustomerErrorCode
from app.core.control_plane_errors import ControlPlaneErrorCode


def test_http_error_vocabularies_have_unique_string_enum_members() -> None:
    for vocabulary in (CustomerErrorCode, ControlPlaneErrorCode):
        assert issubclass(vocabulary, StrEnum)
        assert len(vocabulary.__members__) == len(vocabulary)
        assert all(isinstance(code.value, str) and code.value for code in vocabulary)
