export type ScoreDetailSource = 'my-scores';

export function parseScoreDetailSource(value: string | undefined): ScoreDetailSource | null {
  return value === 'my-scores' ? value : null;
}
