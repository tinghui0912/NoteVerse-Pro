export function parseApiDate(value: string | undefined) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

export function formatApiDateTime(value: string | undefined, _locale?: string) {
  const date = parseApiDate(value);
  if (!date) return '-';
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-') + ` ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function formatKeySignature(
  fifths: number | null | undefined,
  mode: string | null | undefined
) {
  if (fifths === null || fifths === undefined) return '-';
  const majorKeys = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const minorKeys = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];
  const index = fifths + 7;
  if (index < 0 || index >= majorKeys.length) return String(fifths);
  return mode === 'minor' ? minorKeys[index] : majorKeys[index];
}
