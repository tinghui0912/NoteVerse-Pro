const root = ['imports'] as const;

export const importQueryKeys = {
  all: root,
  jobs: {
    all: [...root, 'jobs'] as const,
    lists: () => [...root, 'jobs', 'list'] as const,
    list: (page: number, pageSize: number) =>
      [...root, 'jobs', 'list', { page, pageSize }] as const,
    detail: (jobId: string) => [...root, 'jobs', 'detail', { jobId }] as const,
  },
  review: (jobId: string) => [...root, 'review', { jobId }] as const,
};
