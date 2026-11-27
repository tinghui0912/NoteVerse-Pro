/** Opaque source bytes and DOM addresses, never a parallel musical model. */
export class UnsupportedEditorMusicXmlError extends Error {}
export class EditorMusicXmlSerializationError extends Error {}

declare const snapshotBrand: unique symbol;
export type MusicXmlSourceSnapshot = { readonly [snapshotBrand]: true };
export type SourceAnchors = Map<string, number[][]>;
const snapshots = new WeakMap<MusicXmlSourceSnapshot, { xml: string; anchors: SourceAnchors }>();

export function parseSource(xml: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (
    document.querySelector('parsererror') ||
    document.documentElement.localName !== 'score-partwise'
  ) {
    throw new UnsupportedEditorMusicXmlError(
      'A valid score-partwise MusicXML document is required.',
    );
  }
  if (document.documentElement.namespaceURI) {
    throw new UnsupportedEditorMusicXmlError(
      'Namespaced MusicXML is not supported by this adapter.',
    );
  }
  return document;
}

export function remember(anchors: SourceAnchors, key: string, nodes: Node[]) {
  anchors.set(
    key,
    nodes.map((node) => {
      const path: number[] = [];
      for (let current = node; current.parentNode; current = current.parentNode) {
        path.unshift(Array.from(current.parentNode.childNodes).indexOf(current as ChildNode));
      }
      return path;
    }),
  );
}

export function captureSource(xml: string, anchors: SourceAnchors): MusicXmlSourceSnapshot {
  const source = Object.freeze({}) as MusicXmlSourceSnapshot;
  snapshots.set(source, {
    xml,
    anchors: new Map(Array.from(anchors, ([key, paths]) => [key, paths.map((path) => [...path])])),
  });
  return source;
}

export function openSource(source: MusicXmlSourceSnapshot) {
  const snapshot = snapshots.get(source);
  if (!snapshot)
    throw new EditorMusicXmlSerializationError('An imported source snapshot is required.');
  const xml = parseSource(snapshot.xml);
  const anchors = new Map<string, Element[]>();
  for (const [key, paths] of snapshot.anchors) {
    anchors.set(
      key,
      paths.map((path) => {
        let node: Node = xml;
        for (const index of path) node = node.childNodes[index];
        if (node.nodeType !== 1)
          throw new EditorMusicXmlSerializationError('Invalid source address.');
        return node as Element;
      }),
    );
  }
  return { xml, anchors };
}
