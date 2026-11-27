import type {
  DocumentMetadata,
  Measure,
  PartId,
  StaffId,
  TempoNotation,
} from '../editor-domain/model';
import { integer } from './context';
import { UnsupportedEditorMusicXmlError } from './source';

// Project A4 MusicXML coordinate profile, aligned with backend XmlLayoutConfig.
const CREDIT_CONFIG = {
  TITLE_CENTER_X: '600.241935',
  TITLE: {
    defaultY: '1611.210312',
    fontSize: '22',
    justify: 'center',
    valign: 'top',
    creditType: 'title',
  },
  SUBTITLE: {
    defaultY: '1554.060198',
    fontSize: '14',
    justify: 'center',
    valign: 'top',
    creditType: 'subtitle',
  },
  COMPOSER: {
    defaultX: '1114.7587',
    defaultY: '1460.000000',
    justify: 'right',
    valign: 'bottom',
    creditType: 'composer',
  },
  LYRICIST: {
    defaultX: '1114.7587',
    defaultY: '1495.000000',
    justify: 'right',
    valign: 'bottom',
    creditType: 'lyricist',
  },
  COPYRIGHT: {
    defaultX: '600.241935',
    defaultY: '85.725171',
    fontSize: '9',
    justify: 'center',
    valign: 'bottom',
    creditType: 'rights',
  },
} as const;

/**
 * Find the <credit> element for a given credit-type.
 */
function findCreditByType(xmlDoc: XMLDocument, creditType: string): Element | null {
  const credits = xmlDoc.querySelectorAll('credit');
  for (const credit of credits) {
    const typeEl = credit.querySelector('credit-type');
    if (typeEl?.textContent?.trim() === creditType) {
      return credit;
    }
  }
  return null;
}

/**
 * Update or create a <credit> element using the project A4 MusicXML layout.
 *
 * Structure:
 * <credit page="1">
 *   <credit-type>...</credit-type>
 *   <credit-words default-x="..." default-y="..." justify="..." valign="..." [font-size="..."]>text</credit-words>
 * </credit>
 */
function upsertCredit(
  xmlDoc: XMLDocument,
  root: Element,
  creditType: string,
  text: string,
  attrs: {
    defaultX: string;
    defaultY: string;
    justify: string;
    valign: string;
    fontSize?: string;
  },
): void {
  let credit = findCreditByType(xmlDoc, creditType);

  if (!text || text.trim() === '') {
    // Remove the whole credit element when the text is blank.
    if (credit) credit.parentNode?.removeChild(credit);
    return;
  }

  if (credit) {
    // Existing credit: update only credit-words text and preserve attributes.
    const cw = credit.querySelector('credit-words');
    if (cw) {
      cw.textContent = text;
    }
  } else {
    // Missing credit: create the full credit element.
    credit = xmlDoc.createElement('credit');
    credit.setAttribute('page', '1');

    // Keep credit-type before credit-words to match MusicXML element order.
    const ct = xmlDoc.createElement('credit-type');
    ct.textContent = creditType;
    credit.appendChild(ct);

    const cw = xmlDoc.createElement('credit-words');
    cw.setAttribute('default-x', attrs.defaultX);
    cw.setAttribute('default-y', attrs.defaultY);
    cw.setAttribute('justify', attrs.justify);
    cw.setAttribute('valign', attrs.valign);
    if (attrs.fontSize) {
      cw.setAttribute('font-size', attrs.fontSize);
    }
    cw.textContent = text;
    credit.appendChild(cw);

    // Insert credits before <part-list> when possible.
    const partList = xmlDoc.querySelector('part-list');
    if (partList) {
      root.insertBefore(credit, partList);
    } else {
      root.appendChild(credit);
    }
  }
}

const text = (element: Element | null | undefined) => element?.textContent?.trim() || null;
export function readDocumentMetadata(xml: XMLDocument): DocumentMetadata {
  const first = xml.querySelector('part > measure');
  const mark = first?.querySelector('direction > direction-type > metronome');
  let tempoNotation: TempoNotation | null = null;
  if (mark) {
    const perMinute = Number(text(mark.querySelector('per-minute')));
    const beatUnit = text(mark.querySelector('beat-unit'));
    if (
      !perMinute ||
      perMinute <= 0 ||
      !['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'].includes(beatUnit ?? '')
    )
      throw new UnsupportedEditorMusicXmlError('Unsupported tempo notation.');
    tempoNotation = {
      perMinute,
      beatUnit: beatUnit as TempoNotation['beatUnit'],
      dots: mark.querySelectorAll('beat-unit-dot').length,
      visible: mark.closest('direction')?.getAttribute('print-object') !== 'no',
    };
  }
  return {
    notationTitle: text(xml.querySelector('work > work-title')),
    subtitle:
      text(findCreditByType(xml, 'subtitle')?.querySelector('credit-words')) ??
      text(xml.querySelector('movement-title')),
    composer: text(xml.querySelector('identification > creator[type="composer"]')),
    lyricist: text(xml.querySelector('identification > creator[type="lyricist"]')),
    copyright: text(xml.querySelector('identification > rights')),
    tempoNotation,
  };
}
export function readMeasureAttributes(measure: Element, partId: PartId): Measure['attributes'] {
  const result: Measure['attributes'] = {};
  let timed = false;
  for (const element of Array.from(measure.children)) {
    if (['note', 'forward', 'backup'].includes(element.tagName)) timed = true;
    if (element.tagName === 'attributes' && timed && element.querySelector('key, clef'))
      throw new UnsupportedEditorMusicXmlError(
        'Mid-measure key or clef changes require positional context support.',
      );
  }
  for (const attrs of Array.from(measure.querySelectorAll(':scope > attributes'))) {
    if (attrs.querySelector('key[number]'))
      throw new UnsupportedEditorMusicXmlError(
        'Staff-specific key context requires explicit domain support.',
      );
    const time = attrs.querySelector(':scope > time');
    if (time)
      result.meter = time.querySelector('senza-misura')
        ? null
        : {
            beats: integer(time.querySelector('beats')?.textContent, 'beats', 1),
            beatType: integer(time.querySelector('beat-type')?.textContent, 'beat type', 1),
          };
    const fifths = attrs.querySelector(':scope > key > fifths');
    if (fifths) {
      const value = Number(text(fifths));
      if (!Number.isInteger(value) || Math.abs(value) > 7)
        throw new UnsupportedEditorMusicXmlError('Unsupported key signature.');
      result.key = {
        fifths: value,
        ...(text(fifths.parentElement?.querySelector('mode'))
          ? { mode: text(fifths.parentElement?.querySelector('mode'))! }
          : {}),
      };
    }
    for (const clef of Array.from(attrs.querySelectorAll(':scope > clef'))) {
      const sign = text(clef.querySelector('sign'));
      if (!sign) throw new UnsupportedEditorMusicXmlError('Clef sign is required.');
      const line = clef.querySelector('line');
      const octave = clef.querySelector('clef-octave-change');
      result.clefs ??= [];
      result.clefs = result.clefs.filter(
        (context) =>
          context.staffId !==
          `${partId}:staff-${integer(clef.getAttribute('number') ?? '1', 'clef staff', 1)}`,
      );
      result.clefs.push({
        staffId:
          `${partId}:staff-${integer(clef.getAttribute('number') ?? '1', 'clef staff', 1)}` as StaffId,
        clef: {
          sign,
          ...(line ? { line: integer(text(line), 'clef line', 1) } : {}),
          ...(octave ? { octaveChange: Number(text(octave)) } : {}),
        },
      });
    }
  }
  return result;
}
function child(parent: Element, name: string, order: string[]) {
  const existing = parent.querySelector(':scope > ' + name);
  if (existing) return existing;
  const element = parent.ownerDocument.createElement(name);
  parent.insertBefore(
    element,
    Array.from(parent.children).find(
      (candidate) => order.indexOf(candidate.tagName) > order.indexOf(name),
    ) ?? null,
  );
  return element;
}
const rootOrder = [
  'work',
  'movement-number',
  'movement-title',
  'identification',
  'defaults',
  'credit',
  'part-list',
  'part',
];
export function writeDocumentMetadata(xml: XMLDocument, metadata: DocumentMetadata) {
  const before = readDocumentMetadata(xml);
  const root = xml.documentElement;
  const creditConfigs = {
    notationTitle: CREDIT_CONFIG.TITLE,
    subtitle: CREDIT_CONFIG.SUBTITLE,
    composer: CREDIT_CONFIG.COMPOSER,
    lyricist: CREDIT_CONFIG.LYRICIST,
    copyright: CREDIT_CONFIG.COPYRIGHT,
  };
  for (const field of ['notationTitle', 'subtitle', 'composer', 'lyricist', 'copyright'] as const) {
    if (metadata[field] === before[field]) continue;
    const value = metadata[field] ?? '';
    if (field === 'notationTitle')
      child(child(root, 'work', rootOrder), 'work-title', [
        'work-number',
        'work-title',
        'opus',
      ]).textContent = value;
    if (field === 'subtitle' && xml.querySelector('movement-title'))
      xml.querySelector('movement-title')!.textContent = value;
    if (field === 'composer' || field === 'lyricist' || field === 'copyright') {
      const identification = child(root, 'identification', rootOrder);
      const selector = field === 'copyright' ? 'rights' : `creator[type="${field}"]`;
      let element = identification.querySelector(selector);
      if (!value) element?.remove();
      else {
        if (!element) {
          element = xml.createElement(field === 'copyright' ? 'rights' : 'creator');
          if (field !== 'copyright') element.setAttribute('type', field);
          identification.insertBefore(
            element,
            identification.querySelector(field === 'copyright' ? 'encoding' : 'rights, encoding'),
          );
        }
        element.textContent = value;
      }
    }
    const config = creditConfigs[field];
    upsertCredit(xml, root, config.creditType, value, {
      defaultX: 'defaultX' in config ? config.defaultX : CREDIT_CONFIG.TITLE_CENTER_X,
      defaultY: config.defaultY,
      justify: config.justify,
      valign: config.valign,
      ...('fontSize' in config ? { fontSize: config.fontSize } : {}),
    });
  }
  if (JSON.stringify(metadata.tempoNotation) !== JSON.stringify(before.tempoNotation)) {
    const measure = xml.querySelector('part > measure');
    if (!measure) throw new UnsupportedEditorMusicXmlError('Tempo needs a measure.');
    const tempo = metadata.tempoNotation;
    let mark = measure.querySelector('direction > direction-type > metronome');
    let direction = mark?.closest('direction') ?? null;
    if (
      direction &&
      tempo &&
      tempo.visible !== before.tempoNotation?.visible &&
      direction.querySelector('direction-type > :not(metronome)')
    )
      throw new UnsupportedEditorMusicXmlError(
        'A mixed direction cannot change tempo visibility safely.',
      );
    measure.querySelectorAll('sound[tempo]').forEach((sound) => {
      sound.removeAttribute('tempo');
      if (!sound.attributes.length && !sound.children.length) sound.remove();
    });
    if (!tempo) {
      mark?.remove();
      return;
    }
    if (!direction) {
      direction = xml.createElement('direction');
      direction.setAttribute('placement', 'above');
      measure.insertBefore(
        direction,
        Array.from(measure.children).find(
          (item) => !['print', 'attributes'].includes(item.tagName),
        ) ?? null,
      );
    }
    if (tempo.visible) direction.removeAttribute('print-object');
    else direction.setAttribute('print-object', 'no');
    if (!mark) {
      mark = xml.createElement('metronome');
      child(direction, 'direction-type', [
        'direction-type',
        'offset',
        'footnote',
        'level',
        'voice',
        'staff',
        'sound',
      ]).appendChild(mark);
    }
    child(mark, 'beat-unit', ['beat-unit', 'beat-unit-dot', 'per-minute']).textContent =
      tempo.beatUnit;
    const dots = Array.from(mark.querySelectorAll(':scope > beat-unit-dot'));
    dots.slice(tempo.dots).forEach((dot) => dot.remove());
    for (let dot = dots.length; dot < tempo.dots; dot++)
      mark.insertBefore(xml.createElement('beat-unit-dot'), mark.querySelector('per-minute'));
    child(mark, 'per-minute', ['beat-unit', 'beat-unit-dot', 'per-minute']).textContent = String(
      tempo.perMinute,
    );
  }
}
export function writeMeasureAttributes(element: Element, measure: Measure) {
  const before = readMeasureAttributes(element, measure.partId);
  const order = [
    'divisions',
    'key',
    'time',
    'staves',
    'part-symbol',
    'instruments',
    'clef',
    'staff-details',
    'transpose',
  ];
  for (const field of ['meter', 'key'] as const) {
    if (JSON.stringify(before[field]) === JSON.stringify(measure.attributes[field])) continue;
    let attributes = element.querySelector(':scope > attributes');
    if (!attributes) {
      attributes = element.ownerDocument.createElement('attributes');
      element.insertBefore(
        attributes,
        element.querySelector(
          ':scope > note, :scope > direction, :scope > backup, :scope > forward',
        ),
      );
    }
    const desired = measure.attributes[field];
    const node = child(attributes, field === 'meter' ? 'time' : 'key', order);
    if (desired === undefined) {
      node.remove();
      continue;
    }
    if (field === 'meter') {
      const meter = measure.attributes.meter;
      node.replaceChildren();
      if (!meter) node.appendChild(element.ownerDocument.createElement('senza-misura'));
      else {
        child(node, 'beats', ['beats', 'beat-type']).textContent = String(meter.beats);
        child(node, 'beat-type', ['beats', 'beat-type']).textContent = String(meter.beatType);
      }
    } else {
      const key = measure.attributes.key!;
      child(node, 'fifths', ['cancel', 'fifths', 'mode']).textContent = String(key.fifths);
      if (key.mode) child(node, 'mode', ['cancel', 'fifths', 'mode']).textContent = key.mode;
      else node.querySelector('mode')?.remove();
    }
  }
}
