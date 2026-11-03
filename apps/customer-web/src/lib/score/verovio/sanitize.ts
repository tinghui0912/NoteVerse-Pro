import { parseXml, serializeXml } from '@/lib/musicxml/core';

export function sanitizeMusicXmlForVerovio(xml: string) {
  const xmlDoc = parseXml(xml);
  const measures = Array.from(xmlDoc.querySelectorAll('measure'));

  for (const measure of measures) {
    const anchorByVoiceStaff = new Map<string, Element>();

    for (const child of Array.from(measure.children)) {
      if (child.localName === 'sound' && child.hasAttribute('tempo')) {
        // Keep the original sound on the importer's standalone semantic path.
        // A sibling exposes only its positioned tempo; ingestion owns numeric meaning.
        const direction = xmlDoc.createElementNS(child.namespaceURI, 'direction');
        const tempo = xmlDoc.createElementNS(child.namespaceURI, 'sound');
        tempo.setAttribute('tempo', child.getAttribute('tempo')!);
        for (const offset of Array.from(child.children).filter(element => element.localName === 'offset')) {
          tempo.append(offset.cloneNode(true));
        }
        direction.append(tempo);
        projectTempoPlaybackOffset(direction);
        child.after(direction);
        continue;
      }
      if (child.localName === 'direction') {
        projectTempoPlaybackOffset(child);
      }
      if (child.tagName !== 'note') {
        continue;
      }

      const voice = child.querySelector('voice')?.textContent?.trim() || '1';
      const staff = child.querySelector('staff')?.textContent?.trim() || '1';
      const key = `${voice}:${staff}`;
      const hasChordTag = child.querySelector('chord') !== null;
      const hasPitch = child.querySelector('pitch') !== null;
      const hasRest = child.querySelector('rest') !== null;

      if (hasChordTag) {
        child.querySelectorAll('beam').forEach((beam) => beam.remove());

        const anchor = anchorByVoiceStaff.get(key);
        if (!anchor || hasRest || !hasPitch) {
          child.querySelector('chord')?.remove();
          anchorByVoiceStaff.set(key, child);
        }
        continue;
      }

      anchorByVoiceStaff.set(key, child);
    }
  }

  return serializeXml(xmlDoc);
}

function projectTempoPlaybackOffset(direction: Element) {
  const sound = Array.from(direction.children).find(child => child.localName === 'sound');
  if (!sound?.hasAttribute('tempo')) return;
  const offsets = Array.from(direction.children).filter(child => child.localName === 'offset');
  const soundOffsets = Array.from(sound.children).filter(child => child.localName === 'offset');
  if (offsets.length > 1 || soundOffsets.length > 1) throw new Error('Ambiguous sound playback offset');
  const flag = offsets[0]?.getAttribute('sound') ?? 'no';
  if (flag !== 'yes' && flag !== 'no') throw new Error('Invalid direction offset sound attribute');
  // Renderer integration only: copy the selected literal positioning structure.
  // Verovio ignores sound-owned offsets and treats every direction offset as playback.
  const selected = soundOffsets[0] ?? (flag === 'yes' ? offsets[0] : undefined);
  const projected = selected?.cloneNode(true) as Element | undefined;
  offsets.forEach(offset => offset.remove());
  if (projected) {
    projected.setAttribute('sound', 'yes');
    sound.before(projected);
  }
}

export function readNumericTimemapValue(entry: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}
