import type { Rational, RhythmicValue } from '../editor-domain/model';
import { UnsupportedEditorMusicXmlError } from './source';

export function integer(value: string | null | undefined, field: string, minimum = 0): number {
  const text = value?.trim();
  const number = Number(text);
  if (!text || !Number.isSafeInteger(number) || number < minimum) {
    throw new UnsupportedEditorMusicXmlError(`Invalid or missing ${field}.`);
  }
  return number;
}

export function rational(numerator: number, denominator: number): Rational {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new UnsupportedEditorMusicXmlError('A finite exact musical duration is required.');
  }
  let a = Math.abs(numerator),
    b = denominator;
  while (b) [a, b] = [b, a % b];
  return { numerator: numerator / (a || 1), denominator: denominator / (a || 1) };
}

export const durationBases = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 1 / 2,
  '16th': 1 / 4,
  '32nd': 1 / 8,
  '64th': 1 / 16,
} as const;
export function rhythmLength(base: RhythmicValue['notation']['base'], dots: number): number {
  return durationBases[base] * (2 - 1 / 2 ** dots);
}

export type MeasureContext = { divisions: number | undefined; meter: Rational | undefined };
export function measureContexts(xml: XMLDocument): Map<Element, MeasureContext> {
  const result = new Map<Element, MeasureContext>();
  for (const part of Array.from(xml.querySelectorAll('score-partwise > part'))) {
    let divisions: number | undefined;
    let meter: Rational | undefined;
    for (const measure of Array.from(part.querySelectorAll(':scope > measure'))) {
      let timed = false;
      for (const child of Array.from(measure.children)) {
        if (['note', 'forward', 'backup'].includes(child.tagName)) timed = true;
        if (child.tagName !== 'attributes') continue;
        const division = child.querySelector(':scope > divisions');
        const times = child.querySelectorAll(':scope > time');
        if (timed && (division || times.length))
          throw new UnsupportedEditorMusicXmlError(
            'Mid-measure divisions or meter changes cannot be edited safely.',
          );
        if (division) divisions = integer(division.textContent, 'divisions', 1);
        if (times.length > 1 || Array.from(times).some((time) => time.hasAttribute('number')))
          throw new UnsupportedEditorMusicXmlError(
            'Staff-specific meters require explicit domain support.',
          );
        if (times.length) {
          const time = times[0];
          if (time.querySelector('senza-misura')) meter = undefined;
          else {
            if (
              time.querySelectorAll('beats').length !== 1 ||
              time.querySelectorAll('beat-type').length !== 1
            )
              throw new UnsupportedEditorMusicXmlError(
                'Composite meter requires explicit domain support.',
              );
            meter = rational(
              integer(time.querySelector('beats')?.textContent, 'beats', 1) * 4,
              integer(time.querySelector('beat-type')?.textContent, 'beat-type', 1),
            );
          }
        }
      }
      result.set(measure, { divisions, meter });
    }
  }
  return result;
}
