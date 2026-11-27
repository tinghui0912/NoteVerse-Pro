const root = ['guest-preview'] as const;

export const guestPreviewQueryKeys = {
  all: root,
  settings: (scoreId: string) => [...root, 'settings', { scoreId }] as const,
  publics: () => [...root, 'public'] as const,
  public: (token: string) => [...root, 'public', { token }] as const,
};
