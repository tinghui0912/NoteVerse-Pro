"""Import dispatch retry, lease, and orphan-upload retention settings."""

from pydantic import BaseModel, field_validator


class ImportDispatchSettings(BaseModel):
    """Shared policy for import delivery and its upload lifecycle."""

    IMPORT_DISPATCH_INTERVAL_SECONDS: int = 30
    IMPORT_DISPATCH_TIMEOUT_SECONDS: int = 300
    IMPORT_PROCESSING_TIMEOUT_SECONDS: int = 1200
    IMPORT_DISPATCH_MAX_ATTEMPTS: int = 3
    IMPORT_DISPATCH_BATCH_SIZE: int = 20
    ORPHAN_UPLOAD_TTL_SECONDS: int = 86400

    @field_validator(
        "IMPORT_DISPATCH_INTERVAL_SECONDS",
        "IMPORT_DISPATCH_TIMEOUT_SECONDS",
        "IMPORT_PROCESSING_TIMEOUT_SECONDS",
        "IMPORT_DISPATCH_MAX_ATTEMPTS",
        "IMPORT_DISPATCH_BATCH_SIZE",
        "ORPHAN_UPLOAD_TTL_SECONDS",
    )
    @classmethod
    def validate_positive_import_dispatch_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("import dispatch settings must be positive integers")
        return value
