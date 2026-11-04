import { parseXml, serializeXml } from '@/lib/musicxml/core';

export function sanitizeMusicXmlForVerovio(xml: string) {
  const xmlDoc = parseXml(xml);
  const measures = Array.from(xmlDoc.querySelectorAll('measure'));

  for (const measure of measures) {
    const anchorByVoiceStaff = new Map<string, Element>();

    for (const child of Array.from(measure.children)) {
      if (child.localName === 'sound' && child.hasAttribute('tempo')) {
        // Retain the original standalone importer path for every non-tempo fact.
        child.after(createTempoPlaybackAid(xmlDoc, child));
        continue;
      }
      if (child.localName === 'direction') {
        const sound = Array.from(child.children).find(element => element.localName === 'sound');
        if (sound?.hasAttribute('tempo')) {
          child.after(createTempoPlaybackAid(xmlDoc, sound, child));
        }
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

function createTempoPlaybackAid(xmlDoc: XMLDocument, sound: Element, direction?: Element) {
  const offsets = direction ? Array.from(direction.children).filter(child => child.localName === 'offset') : [];
  const soundOffsets = Array.from(sound.children).filter(child => child.localName === 'offset');
  if (offsets.length > 1 || soundOffsets.length > 1) throw new Error('Ambiguous sound playback offset');
  const flag = offsets[0]?.getAttribute('sound') ?? 'no';
  if (flag !== 'yes' && flag !== 'no') throw new Error('Invalid direction offset sound attribute');
  // Preserve visual placement in the original direction. Verovio consumes the
  // playback fact separately, with only the selected literal positioning structure.
  const selected = soundOffsets[0] ?? (flag === 'yes' ? offsets[0] : undefined);
  const aid = xmlDoc.createElementNS(sound.namespaceURI, 'direction');
  if (selected) {
    const offset = selected.cloneNode(true) as Element;
    offset.setAttribute('sound', 'yes');
    aid.append(offset);
  }
  const playback = xmlDoc.createElementNS(sound.namespaceURI, 'sound');
  playback.setAttribute('tempo', sound.getAttribute('tempo')!);
  aid.append(playback);
  sound.removeAttribute('tempo');
  return aid;
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
