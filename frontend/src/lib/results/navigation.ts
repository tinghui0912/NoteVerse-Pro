export type ResultsHistorySource = 'shares' | 'uploads';

export function parseResultsHistorySource(value: string | undefined): ResultsHistorySource | null {
  return value === 'shares' || value === 'uploads' ? value : null;
}
