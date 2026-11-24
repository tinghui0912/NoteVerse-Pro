from __future__ import annotations


from pydantic import BaseModel

from app.db.models.storage_usage import StorageUsageCategory
from app.shared.api_model import ApiModel


class StorageUsageBreakdownRead(BaseModel):
    category: StorageUsageCategory
    used_bytes: int
    reserved_bytes: int
    counts_toward_quota: bool


class StorageUsageQuotaRead(BaseModel):
    used_bytes: int
    reserved_bytes: int
    limit_bytes: int | None
    available_bytes: int | None


class StorageUsageRead(ApiModel):
    quota: StorageUsageQuotaRead
    breakdown: list[StorageUsageBreakdownRead]
