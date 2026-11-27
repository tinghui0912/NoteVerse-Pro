const root = ['storage-usage'] as const;

export const storageUsageQueryKeys = {
  all: root,
  current: () => [...root, 'current'] as const,
};
