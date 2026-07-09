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
