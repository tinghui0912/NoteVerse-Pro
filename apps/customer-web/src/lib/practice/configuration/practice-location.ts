export function practiceLocation(scoreId: string, target: 'practice' | 'setup', revisionId?: string | null): string {
  const query = revisionId ? `?${new URLSearchParams({ practiceRevisionId: revisionId })}` : '';
  return `/score/${encodeURIComponent(scoreId)}/practice${target === 'setup' ? '/setup' : ''}${query}`;
}
