import { parseXml, serializeXml } from './core';

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const APP_ID_PREFIX = 'nv';

const XML_ID_START = /[A-Za-z_]/;
const XML_ID_BODY = /[A-Za-z0-9_.-]/;

function sanitizeXmlId(value: string): string {
  const trimmed = value.trim();
  let result = '';

  for (const char of trimmed) {
    result += XML_ID_BODY.test(char) ? char : '-';
  }

  if (!result || !XML_ID_START.test(result[0])) {
    result = `${APP_ID_PREFIX}-${result || 'entity'}`;
  }

  return result;
}

function getExistingXmlId(element: Element): string | null {
  return element.getAttributeNS(XML_NAMESPACE, 'id') || element.getAttribute('xml:id') || element.getAttribute('id');
}

function setXmlId(element: Element, id: string): void {
  element.setAttributeNS(XML_NAMESPACE, 'xml:id', id);
  element.setAttribute('id', id);
}

function getElementSignature(element: Element, index: number): string {
  const measure = element.closest('measure');
  const part = element.closest('part');
  const measureNumber = sanitizeXmlId(measure?.getAttribute('number') || String(index + 1));
  const partId = sanitizeXmlId(part?.getAttribute('id') || 'part');
  const tag = element.tagName.toLowerCase();

  return `${APP_ID_PREFIX}-${partId}-m${measureNumber}-${tag}-${index + 1}`;
}

function createUniqueId(baseId: string, usedIds: Set<string>): string {
  const sanitized = sanitizeXmlId(baseId);
  if (!usedIds.has(sanitized)) return sanitized;

  let suffix = 2;
  while (usedIds.has(`${sanitized}-${suffix}`)) {
    suffix += 1;
  }
  return `${sanitized}-${suffix}`;
}

/**
 * Ensures every editable MusicXML event has a stable XML id.
 *
 * Existing legal unique ids are preserved. Missing, duplicate, or invalid ids
 * are replaced with app-owned ids and written back into the XML document.
 */
export function ensureStableMusicXmlIds(xmlDoc: XMLDocument): boolean {
  const usedIds = new Set<string>();
  let changed = false;

  Array.from(xmlDoc.querySelectorAll('note, forward')).forEach((element, index) => {
    const existing = getExistingXmlId(element);
    const sanitizedExisting = existing ? sanitizeXmlId(existing) : '';
    const canKeepExisting = existing && sanitizedExisting === existing && !usedIds.has(existing);
    const nextId = canKeepExisting
      ? existing
      : createUniqueId(sanitizedExisting || getElementSignature(element, index), usedIds);

    usedIds.add(nextId);

    if (
      existing !== nextId ||
      element.getAttributeNS(XML_NAMESPACE, 'id') !== nextId ||
      element.getAttribute('id') !== nextId
    ) {
      setXmlId(element, nextId);
      changed = true;
    }
  });

  return changed;
}

export function ensureStableMusicXmlIdsString(xml: string): string {
  const xmlDoc = parseXml(xml);
  const changed = ensureStableMusicXmlIds(xmlDoc);
  return changed ? serializeXml(xmlDoc) : xml;
}
