export type ScoreDetailSource = 'shares' | 'my-scores';

export function parseScoreDetailSource(value: string | undefined): ScoreDetailSource | null {
  return value === 'shares' || value === 'my-scores' ? value : null;
}
