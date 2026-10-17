export function failedCellWitness(errorText) {
  const line = errorText.split('\n')[0], start = line.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(line.slice(start)); } catch { return null; }
}
export function modelRunAccounting(cells) {
  let actualModelRuns = 0, modelRunCountComplete = true;
  for (const cell of cells.filter(c => c.state !== 'NOT_STARTED')) {
    if (cell.result) { actualModelRuns += cell.result.actualModelRuns; continue; }
    const witness = cell.failureWitness;
    if (!witness) { modelRunCountComplete = false; continue; }
    const runtime = witness.engineering?.microphone?.runtime;
    actualModelRuns += runtime?.diagnostics?.at(-1)?.actualSessionRunCount ?? 0;
    if (runtime && (runtime.outstanding !== 0 || runtime.counts.windowsStarted !== runtime.counts.windowsPublished)) modelRunCountComplete = false;
  }
  return { actualModelRuns, modelRunCountComplete };
}
