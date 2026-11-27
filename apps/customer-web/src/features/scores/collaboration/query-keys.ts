const root = ['score-collaboration'] as const;

export const collaborationQueryKeys = {
  all: root,
  myInvites: () => [...root, 'pending'] as const,
  invites: (scoreId: string) => [...root, 'invite', { scoreId }] as const,
  members: (scoreId: string) => [...root, 'member', { scoreId }] as const,
  inspections: () => [...root, 'inspection'] as const,
  inviteAccess: (token: string) => [...root, 'inspection', { token }] as const,
};
