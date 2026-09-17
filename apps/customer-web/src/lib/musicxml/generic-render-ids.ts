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

function localName(element: Element): string {
  return element.localName.toLowerCase();
}

function directChildrenByName(parent: Element, names: ReadonlySet<string>): Element[] {
  return Array.from(parent.children).filter((child) => names.has(localName(child)));
}

function oneBasedOrdinal(items: Element[], element: Element): number {
  const index = items.indexOf(element);
  return index >= 0 ? index + 1 : 1;
}

function getElementSignature(element: Element): string {
  const measure = element.closest('measure');
  const part = element.closest('part');
  const partOrdinal = part?.parentElement
    ? oneBasedOrdinal(directChildrenByName(part.parentElement, new Set(['part'])), part)
    : 1;
  const measureOrdinal = part && measure
    ? oneBasedOrdinal(directChildrenByName(part, new Set(['measure'])), measure)
    : 1;
  const eventOrdinal = measure
    ? oneBasedOrdinal(directChildrenByName(measure, new Set(['note', 'forward'])), element)
    : 1;
  const tag = localName(element);

  return `${APP_ID_PREFIX}-p${partOrdinal}-m${measureOrdinal}-${tag}${eventOrdinal}`;
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
export function ensureGenericRenderMusicXmlIds(xmlDoc: XMLDocument): boolean {
  const usedIds = new Set<string>();
  let changed = false;

  Array.from(xmlDoc.querySelectorAll('note, forward')).forEach((element) => {
    const existing = getExistingXmlId(element);
    const sanitizedExisting = existing ? sanitizeXmlId(existing) : '';
    const canKeepExisting = existing && sanitizedExisting === existing && !usedIds.has(existing);
    const nextId = canKeepExisting
      ? existing
      : createUniqueMusicXmlId(sanitizedExisting || getElementSignature(element), usedIds);

    usedIds.add(nextId);

    if (!canKeepExisting) {
      setGeneratedId(element, nextId);
      changed = true;
    }
  });

  return changed;
}

export function ensureGenericRenderMusicXmlIdsString(xml: string): string {
  const xmlDoc = parseXml(xml);
  const changed = ensureGenericRenderMusicXmlIds(xmlDoc);
  return changed ? serializeXml(xmlDoc) : xml;
}

/** Removes editor-generated ids before persisting canonical MusicXML. */
export function stripAppOwnedGenericRenderMusicXmlIdsString(xml: string): string {
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
export function prepareMusicXmlIdsForGenericVerovioRender(xml: string): string {
  const xmlDoc = parseXml(ensureGenericRenderMusicXmlIdsString(xml));
  let changed = false;
  xmlDoc.querySelectorAll('note, forward').forEach((element) => {
    if (element.hasAttribute(GENERATED_ID_MARKER)) {
      element.removeAttribute(GENERATED_ID_MARKER);
      changed = true;
    }
  });
  return changed ? serializeXml(xmlDoc) : xml;
}
