import { parseXml, serializeXml } from './core';

const APP_ID_PREFIX = 'nv';
const GENERATED_ID_MARKER = 'data-nv-generated-id';

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
  return element.getAttribute('id');
}

function setGeneratedId(element: Element, id: string): void {
  element.setAttribute('id', id);
  element.setAttribute(GENERATED_ID_MARKER, 'true');
}

function getElementSignature(element: Element, index: number): string {
  const measure = element.closest('measure');
  const part = element.closest('part');
  const measureNumber = sanitizeXmlId(measure?.getAttribute('number') || String(index + 1));
  const partId = sanitizeXmlId(part?.getAttribute('id') || 'part');
  const tag = element.tagName.toLowerCase();

  return `${APP_ID_PREFIX}-${partId}-m${measureNumber}-${tag}-${index + 1}`;
}

/**
 * Creates a legal MusicXML/XML identifier that does not collide with a known
 * set of existing identifiers. The caller owns persisting the returned id.
 */
export function createUniqueMusicXmlId(baseId: string, usedIds: ReadonlySet<string>): string {
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
      : createUniqueMusicXmlId(sanitizedExisting || getElementSignature(element, index), usedIds);

    usedIds.add(nextId);

    if (!canKeepExisting) {
      setGeneratedId(element, nextId);
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

/** Removes editor-generated ids before persisting canonical MusicXML. */
export function stripAppOwnedMusicXmlIdsString(xml: string): string {
  const xmlDoc = parseXml(xml);
  let changed = false;
  xmlDoc.querySelectorAll('note, forward').forEach((element) => {
    if (element.getAttribute(GENERATED_ID_MARKER) === 'true') {
      element.removeAttribute('id');
      element.removeAttribute(GENERATED_ID_MARKER);
      changed = true;
    }
  });
  return changed ? serializeXml(xmlDoc) : xml;
}

/** Removes editor-only metadata from Verovio's disposable render copy. */
export function prepareMusicXmlIdsForVerovio(xml: string): string {
  const xmlDoc = parseXml(ensureStableMusicXmlIdsString(xml));
  let changed = false;
  xmlDoc.querySelectorAll('note, forward').forEach((element) => {
    if (element.hasAttribute(GENERATED_ID_MARKER)) {
      element.removeAttribute(GENERATED_ID_MARKER);
      changed = true;
    }
  });
  return changed ? serializeXml(xmlDoc) : xml;
}
