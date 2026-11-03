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
        direction.append(tempo);
        child.after(direction);
        continue;
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
