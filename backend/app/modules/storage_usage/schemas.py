from __future__ import annotations

from pydantic import BaseModel

from app.db.models import StorageUsageCategory


class StorageUsageBreakdownRead(BaseModel):
    category: StorageUsageCategory
    used_bytes: int
    reserved_bytes: int
    counts_toward_quota: bool


class StorageUsageQuotaRead(BaseModel):
    used_bytes: int
    reserved_bytes: int
    limit_bytes: int
    available_bytes: int


class StorageUsageRead(BaseModel):
    quota: StorageUsageQuotaRead
    breakdown: list[StorageUsageBreakdownRead]
