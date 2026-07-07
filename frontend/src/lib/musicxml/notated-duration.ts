export type TupletRatio = { actual: number; normal: number };

export type NotatedDuration = {
  type: string | null;
  beamLevel: number;
  soundingTicks: number;
  dots: number;
  tupletRatio: TupletRatio | null;
  isGrace: boolean;
};

const BEAM_LEVEL_BY_TYPE: Record<string, number> = {
  eighth: 1,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
  '128th': 5,
  '256th': 6,
  '512th': 7,
  '1024th': 8,
};

function positiveInt(text: string | null | undefined): number | null {
  const value = Number.parseInt(text ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function inferBeamLevel(soundingTicks: number, divisions: number, dots: number): number {
  if (soundingTicks <= 0 || divisions <= 0 || soundingTicks >= divisions) return 0;
  const dotMultiplier = 2 - (1 / (2 ** dots));
  const baseTicks = soundingTicks / dotMultiplier;
  const rawLevel = Math.log2(divisions / baseTicks);
  const level = Math.round(rawLevel);
  if (level < 1 || level > 8 || Math.abs(rawLevel - level) > 1e-6) return 0;
  return level;
}

export function parseNotatedDuration(note: Element, divisions: number): NotatedDuration {
  const type = note.querySelector(':scope > type')?.textContent?.trim() || null;
  const soundingTicks = positiveInt(note.querySelector(':scope > duration')?.textContent) ?? 0;
  const dots = note.querySelectorAll(':scope > dot').length;
  const actual = positiveInt(note.querySelector(':scope > time-modification > actual-notes')?.textContent);
  const normal = positiveInt(note.querySelector(':scope > time-modification > normal-notes')?.textContent);

  return {
    type,
    beamLevel: type ? (BEAM_LEVEL_BY_TYPE[type] ?? 0) : inferBeamLevel(soundingTicks, divisions, dots),
    soundingTicks,
    dots,
    tupletRatio: actual && normal ? { actual, normal } : null,
    isGrace: Boolean(note.querySelector(':scope > grace')),
  };
}
