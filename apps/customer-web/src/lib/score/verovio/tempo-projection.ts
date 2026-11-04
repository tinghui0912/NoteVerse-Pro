import { parseXml } from '@/lib/musicxml/core';
import { DEFAULT_SCORE_TEMPO_BPM } from '@/lib/score/tempo-policy';

/** Renderer performance coordinates, including unfolded repeat occurrences. */
export type VerovioPerformanceTiming = {
  mei: string;
  timemap: Array<Record<string, unknown>>;
  expansionMap: Record<string, string[]>;
};

export type PerformanceTempoEvent = Readonly<{ quarter: number; bpm: number }>;

function numeric(value: unknown, label: string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new Error(`Missing renderer ${label}.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid renderer ${label}.`);
  return result;
}

export function performanceQuarter(entry: Record<string, unknown>): number {
  const quarter = numeric(entry.qstamp, 'quarter position');
  if (quarter < 0) throw new Error('Renderer position precedes performance origin.');
  return quarter;
}

/** Integrate renderer facts, never MusicXML notation or note/backup/forward cursors. */
export function projectPerformanceTempos(input: VerovioPerformanceTiming): PerformanceTempoEvent[] {
  const starts = new Map<string, number[]>();
  for (const entry of input.timemap) {
    if (typeof entry.measureOn === 'string') {
      const positions = starts.get(entry.measureOn) ?? [];
      positions.push(performanceQuarter(entry));
      starts.set(entry.measureOn, positions);
    }
  }
  const facts = new Map<number, number>();
  const put = (quarter: number, bpm: number) => {
    if (!Number.isFinite(quarter) || quarter < 0 || !Number.isFinite(bpm) || bpm <= 0) {
      throw new Error('Invalid renderer performance tempo.');
    }
    if (facts.has(quarter) && facts.get(quarter) !== bpm) {
      throw new Error('Conflicting renderer performance tempos.');
    }
    facts.set(quarter, bpm);
  };
  const units = new Map<string, number>();
  // scoreDef midi.bpm can promote a late standalone sound to a global engine rate.
  // Only positioned MEI tempo elements supply performance chronology facts.
  const elements = Array.from(parseXml(input.mei).getElementsByTagName('*'));
  for (const element of elements) {
    if (element.localName === 'staffDef') {
      const signature = Array.from(element.children).find(child => child.localName === 'meterSig');
      if (signature) units.set(element.getAttribute('n')!, numeric(signature.getAttribute('unit'), 'meter unit'));
    }
    if (element.localName !== 'measure') continue;
    for (const staff of Array.from(element.children).filter(child => child.localName === 'staff')) {
      for (const signature of Array.from(staff.getElementsByTagName('*')).filter(child => child.localName === 'meterSig')) {
        units.set(staff.getAttribute('n')!, numeric(signature.getAttribute('unit'), 'meter unit'));
      }
    }
    for (const tempo of Array.from(element.children).filter(child => child.localName === 'tempo')) {
      if (!tempo.hasAttribute('midi.bpm')) {
        // mm-only tempo is presentation notation, not a quarter-BPM playback fact.
        continue;
      }
      const stamp = numeric(tempo.getAttribute('tstamp'), 'tempo timestamp') - 1;
      let offset = 0;
      if (stamp !== 0) {
        const staffUnits = new Set((tempo.getAttribute('staff') ?? '').trim().split(/\s+/).map(staff => units.get(staff)));
        const unit = [...staffUnits][0];
        if (staffUnits.size !== 1 || unit === undefined || unit <= 0) {
          throw new Error('Ambiguous renderer tempo position.');
        }
        offset = stamp * 4 / unit;
      }
      const id = element.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
      if (!id) throw new Error('Missing renderer measure identity.');
      const occurrences = input.expansionMap[id] ?? [id];
      const positions = occurrences.flatMap(identity => starts.get(identity) ?? []);
      if (!positions.length) throw new Error('Missing renderer measure position.');
      for (const position of positions) put(position + offset, numeric(tempo.getAttribute('midi.bpm'), 'quarter BPM'));
    }
  }
  if (!facts.has(0)) put(0, DEFAULT_SCORE_TEMPO_BPM);
  return [...facts].sort(([left], [right]) => left - right).map(([quarter, bpm]) => ({ quarter, bpm }));
}
