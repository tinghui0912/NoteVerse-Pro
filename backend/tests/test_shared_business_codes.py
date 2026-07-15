from app.shared.constants import ErrorCode, SuccessCode


def _public_code_values(code_class: type[object]) -> list[str]:
    values: list[str] = []
    for base in reversed(code_class.__mro__):
        values.extend(
            value
            for name, value in vars(base).items()
            if name.isupper() and isinstance(value, str)
        )
    return values


def test_error_code_values_are_unique() -> None:
    values = _public_code_values(ErrorCode)

    assert len(values) == len(set(values))


def test_success_code_values_are_unique() -> None:
    values = _public_code_values(SuccessCode)

    assert len(values) == len(set(values))
