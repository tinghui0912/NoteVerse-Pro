const root = ['scores'] as const;

export const scoreQueryKeys = {
  all: root,
  details: () => [...root, 'detail'] as const,
  detail: (scoreId: string) => [...root, 'detail', { scoreId }] as const,
  revisions: (scoreId: string) => [...root, 'revision', { scoreId }] as const,
  revision: (scoreId: string, revisionId: string) => [...root, 'revision', { scoreId, revisionId }] as const,
  revisionAssets: (scoreId: string, revisionId?: string) =>
    [...root, 'revision-assets', { scoreId, revisionId: revisionId ?? null }] as const,
};
