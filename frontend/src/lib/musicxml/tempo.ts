import { DEFAULT_TEMPO_BPM } from '../constants/audio';
import { parseXml } from './core';

export function extractTempoBpm(
  xmlString: string,
  fallbackBpm: number = DEFAULT_TEMPO_BPM
): number {
  const document = parseXml(xmlString);
  if (document.querySelector('parsererror')) return fallbackBpm;

  const tempoNode =
    document.querySelector('sound[tempo]') ??
    document.querySelector('metronome per-minute');
  const rawTempo = tempoNode?.getAttribute('tempo') ?? tempoNode?.textContent;
  const tempo = rawTempo ? Number.parseInt(rawTempo, 10) : Number.NaN;

  return Number.isFinite(tempo) && tempo > 0 ? tempo : fallbackBpm;
}
