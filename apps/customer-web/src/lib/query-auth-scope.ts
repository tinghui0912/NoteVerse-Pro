import type { Query } from '@tanstack/react-query';

/** Opt in only when a query's representation cannot depend on the principal. */
export const principalIndependentQueryMeta = Object.freeze({
  authScope: 'principal-independent',
} as const);

interface QueryAuthenticationMeta extends Record<string, unknown> {
  authScope?: typeof principalIndependentQueryMeta.authScope;
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: QueryAuthenticationMeta;
  }
}

/** Unmarked queries are principal-sensitive, including optional-user public reads. */
export function isPrincipalSensitiveQuery(query: Pick<Query, 'meta'>): boolean {
  return query.meta?.authScope !== principalIndependentQueryMeta.authScope;
}
