export type ResultsLibrarySource = 'shares' | 'my-scores';

export function parseResultsLibrarySource(value: string | undefined): ResultsLibrarySource | null {
  return value === 'shares' || value === 'my-scores' ? value : null;
}
