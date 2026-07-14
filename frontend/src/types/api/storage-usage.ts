export type StorageUsageCategory =
  | 'SOURCE'
  | 'UPLOAD'
  | 'INPUT_ASSET'
  | 'DERIVED_RENDER'
  | 'DERIVED_AUDIO'
  | 'TEMP_IMPORT';

export interface StorageUsageQuota {
  used_bytes: number;
  reserved_bytes: number;
  limit_bytes: number;
  available_bytes: number;
}

export interface StorageUsageBreakdownItem {
  category: StorageUsageCategory;
  used_bytes: number;
  reserved_bytes: number;
  counts_toward_quota: boolean;
}

export interface StorageUsage {
  quota: StorageUsageQuota;
  breakdown: StorageUsageBreakdownItem[];
}
