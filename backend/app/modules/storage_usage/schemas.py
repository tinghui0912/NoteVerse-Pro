from __future__ import annotations


from pydantic import BaseModel

from app.db.models import StorageUsageCategory
from app.shared.api_model import ApiModel


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


class StorageUsageRead(ApiModel):
    quota: StorageUsageQuotaRead
    breakdown: list[StorageUsageBreakdownRead]
