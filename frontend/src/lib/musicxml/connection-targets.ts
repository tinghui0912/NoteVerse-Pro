import type { EntityMeta } from '@/types/score-types';

export function getEntityGlobalTick(meta: EntityMeta) {
  return meta.measureIndex * 1_000_000 + (meta.startTick ?? 0);
}

export function orderConnectionEndpoints(start: EntityMeta, end: EntityMeta) {
  return getEntityGlobalTick(start) <= getEntityGlobalTick(end)
    ? [start, end] as const
    : [end, start] as const;
}

function getElementId(element: Element) {
  return (
    element.getAttribute('xml:id') ||
    element.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id') ||
    element.getAttribute('id') ||
    ''
  );
}

export function findConnectionNoteElements(
  xmlDoc: XMLDocument,
  measureIndex: number,
  staveIndex: number,
  xmlVoice: number,
  entityIndex: number,
  sourceId?: string
): Element[] {
  const measures = xmlDoc.querySelectorAll('part > measure');
  if (measureIndex >= measures.length) return [];
  const measure = measures[measureIndex];
  const staff = staveIndex + 1;
  const result: Element[] = [];
  let currentEntityIndex = -1;
  const children = Array.from(measure.childNodes);

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (node.nodeType !== 1) continue;
    const element = node as Element;

    if (element.tagName === 'forward') {
      const forwardStaff = parseInt(element.querySelector('staff')?.textContent || '1', 10);
      const forwardVoice = parseInt(element.querySelector('voice')?.textContent || '1', 10);
      if (forwardStaff === staff && forwardVoice === xmlVoice) currentEntityIndex += 1;
      continue;
    }
    if (element.tagName !== 'note') continue;
    const noteStaff = parseInt(element.querySelector('staff')?.textContent || '1', 10);
    const noteVoice = parseInt(element.querySelector('voice')?.textContent || '1', 10);
    if (noteStaff !== staff || noteVoice !== xmlVoice) continue;

    const isChordPart = element.querySelector('chord') !== null;
    if (!isChordPart) currentEntityIndex += 1;
    if (currentEntityIndex !== entityIndex) continue;
    if (!sourceId || getElementId(element) === sourceId) {
      result.push(element);
    }
    if (isChordPart) continue;

    for (let chordIndex = index + 1; chordIndex < children.length; chordIndex += 1) {
      const chordNode = children[chordIndex];
      if (chordNode.nodeType !== 1) continue;
      const chordElement = chordNode as Element;
      if (chordElement.tagName !== 'note') break;
      const chordStaff = parseInt(chordElement.querySelector('staff')?.textContent || '1', 10);
      const chordVoice = parseInt(chordElement.querySelector('voice')?.textContent || '1', 10);
      if (chordStaff !== staff || chordVoice !== xmlVoice || chordElement.querySelector('chord') === null) break;
      if (!sourceId || getElementId(chordElement) === sourceId) {
        result.push(chordElement);
      }
    }
    return result;
  }
  return result;
}
