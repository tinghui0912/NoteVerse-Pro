/** XML syntax at render/validation/interchange boundaries; no editing semantics. */
export function parseXml(xml: string): XMLDocument {
  return new DOMParser().parseFromString(xml, 'application/xml');
}
export function serializeXml(document: XMLDocument): string {
  return new XMLSerializer().serializeToString(document);
}
