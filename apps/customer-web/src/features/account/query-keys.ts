const root = ['account'] as const;

export const accountQueryKeys = {
  all: root,
  security: () => [...root, 'security'] as const,
  sessions: () => [...root, 'sessions'] as const,
};
