import type { NoteAtom, ScoreDocument, VoiceEvent } from '../editor-domain/model';
import {
  type TieNotationControl,
  type SlurNotationControl,
  getEventNotationControl,
} from '../editor-domain/notation-model';
import { integer, measureContexts, rhythmLength } from './context';
import { writeDocumentMetadata, writeMeasureAttributes } from './metadata';
import {
  EditorMusicXmlSerializationError,
  openSource,
  type MusicXmlSourceSnapshot,
} from './source';

const noteOrder = [
  'chord',
  'pitch',
  'rest',
  'duration',
  'tie',
  'voice',
  'type',
  'dot',
  'accidental',
  'time-modification',
  'stem',
  'notehead',
  'staff',
  'beam',
  'notations',
  'lyric',
];
function fail(message: string): never {
  throw new EditorMusicXmlSerializationError(message);
}

/** Serialize domain intent into a fresh source clone. The snapshot is never mutated. */
export function serializeEditorMusicXml({
  document,
  source,
}: {
  document: ScoreDocument;
  source: MusicXmlSourceSnapshot;
}): string {
  const { xml, anchors } = openSource(source);
  writeDocumentMetadata(xml, document.metadata);
  for (const measure of document.measures) {
    const element = anchors.get(`measure:${measure.id}`)?.[0];
    if (element) writeMeasureAttributes(element, measure);
  }
  const contexts = measureContexts(xml);
  const measureEntries = Array.from(anchors).filter(([key]) => key.startsWith('measure:'));
  if (
    document.parts.length !== xml.querySelectorAll('score-partwise > part').length ||
    document.measures.length !== measureEntries.length
  )
    fail('Part or measure topology changes require explicit adapter support.');
  for (const part of document.parts) {
    const element = anchors.get('part:' + part.id)?.[0];
    const declaration = Array.from(xml.querySelectorAll('part-list > score-part')).find(
      (item) => item.getAttribute('id') === part.id,
    );
    if (!element || declaration?.querySelector('part-name')?.textContent?.trim() !== part.name)
      fail('Part identity or name changes require explicit adapter support.');
    const staffCount = Math.max(
      1,
      ...Array.from(element.querySelectorAll('attributes > staves, note > staff')).map((item) =>
        integer(item.textContent, 'staff count', 1),
      ),
    );
    for (const staff of document.staves.filter((item) => item.partId === part.id)) {
      if (!Number.isSafeInteger(staff.index) || staff.index < 0 || staff.index >= staffCount)
        fail('The source does not declare this staff.');
    }
  }
  const events = new Map(document.events.map((event) => [String(event.id), event]));
  if (events.size !== document.events.length) fail('Event identities must be unique.');
  const atoms = new Map<string, Element>();
  const roots = new Map<string, Element>();
  const processed = new Set<string>();
  const xmlIds = new Set<string>();

  for (const [key, [measure]] of measureEntries) {
    const measureId = key.slice('measure:'.length);
    const modelMeasure = document.measures.find((item) => item.id === measureId);
    if (!modelMeasure || modelMeasure.number !== Number(measure.getAttribute('number')))
      fail('Measure identity cannot be changed implicitly.');
    const partId = measure.parentElement!.getAttribute('id');
    const divisions = contexts.get(measure)!.divisions;
    const measureEvents = document.events.filter((event) => event.position.measureId === measureId);
    if (measureEvents.length && divisions === undefined)
      fail('No inherited divisions exist for this measure.');
    const ticks = (value: { numerator: number; denominator: number }) => {
      if (
        !Number.isSafeInteger(value.numerator) ||
        value.numerator < 0 ||
        !Number.isSafeInteger(value.denominator) ||
        value.denominator <= 0
      )
        fail('An exact nonnegative musical position is required.');
      if (divisions === undefined) fail('An edited position requires inherited divisions.');
      const result = (value.numerator * divisions) / value.denominator;
      if (!Number.isSafeInteger(result))
        fail('The edit cannot be expressed exactly in the source divisions.');
      return result;
    };
    const originals = Array.from(measure.children);
    const originalOffsets = new Map<Element, number>();
    let originalCursor = 0;
    for (const element of originals) {
      originalOffsets.set(element, originalCursor);
      if (element.tagName === 'backup') originalCursor -= duration(element);
      if (
        element.tagName === 'forward' ||
        (element.tagName === 'note' && !element.querySelector(':scope > chord'))
      )
        originalCursor += duration(element);
    }
    let cursor = 0;
    const moveTo = (offset: number, reference: Element | null) => {
      const difference = offset - cursor;
      if (!difference) return;
      if (!Number.isSafeInteger(difference)) fail('A source cursor movement must be exact.');
      const instruction = xml.createElement(difference > 0 ? 'forward' : 'backup');
      scalar(instruction, 'duration', Math.abs(difference));
      measure.insertBefore(instruction, reference);
      cursor = offset;
    };
    const writeEvent = (event: VoiceEvent, reference: Element | null) => {
      const voice = document.voices.find((item) => item.id === event.voiceId);
      const staff = document.staves.find((item) => item.id === event.staffId);
      if (
        !voice ||
        !staff ||
        voice.partId !== partId ||
        staff.partId !== partId ||
        voice.stemPolicy !== 'automatic'
      )
        fail('The event needs a declared source part, staff and voice.');
      const voiceNumber = voice.number;
      if (!Number.isSafeInteger(voiceNumber) || voiceNumber < 1)
        fail('A positive integral voice number is required.');
      const length = ticks(event.rhythm.timelineDuration);
      if (
        length <= 0 ||
        event.rhythm.tupletId ||
        !Number.isSafeInteger(event.rhythm.notation.dots) ||
        event.rhythm.notation.dots < 0 ||
        rhythmLength(event.rhythm.notation.base, event.rhythm.notation.dots) !==
          event.rhythm.timelineDuration.numerator / event.rhythm.timelineDuration.denominator
      )
        fail('The edited rhythm cannot be represented safely.');
      moveTo(ticks(event.position.offset), reference);
      const oldGroup = anchors.get('event:' + event.id) ?? [];
      if (
        oldGroup.length &&
        Boolean(oldGroup[0].querySelector(':scope > rest')) !== (event.kind === 'explicitRest')
      )
        fail('Event-kind replacement requires an explicit delete and insertion.');
      const notes = event.kind === 'pitched' ? event.notes : [undefined];
      const used = new Set<Element>();
      notes.forEach((atom, index) => {
        const existing = atom ? anchors.get('atom:' + atom.id)?.[0] : oldGroup[0];
        if (existing && !oldGroup.includes(existing))
          fail('Moving note atoms between events is unsupported.');
        const note = existing ?? xml.createElement('note');
        const fresh = !existing;
        used.add(note);
        if (fresh)
          note.setAttribute(
            'id',
            String(
              atom?.source?.musicXmlElementId ??
                atom?.id ??
                (event.kind === 'explicitRest' ? event.source?.musicXmlElementId : undefined) ??
                event.id,
            ),
          );
        const id = note.getAttribute('id');
        if (id && xmlIds.has(id)) fail('Serialized note IDs must be unique.');
        if (id) xmlIds.add(id);
        toggle(note, 'chord', index > 0);
        if (atom) patchPitch(note, atom);
        else if (!note.querySelector(':scope > rest')) insert(note, xml.createElement('rest'));
        scalar(note, 'duration', length);
        if (fresh || note.querySelector(':scope > type'))
          scalar(note, 'type', event.rhythm.notation.base);
        dots(note, event.rhythm.notation.dots);
        if (fresh || note.querySelector(':scope > voice') || Number(voiceNumber) !== 1)
          scalar(note, 'voice', Number(voiceNumber));
        if (fresh || note.querySelector(':scope > staff') || staff.index !== 0)
          scalar(note, 'staff', staff.index + 1);
        if (index === 0 && event.kind === 'pitched')
          scalar(
            note,
            'stem',
            getEventNotationControl(document.notationControls, event.id)?.stemDirection,
          );
        if (reference !== note) measure.insertBefore(note, reference);
        if (atom) {
          if (atoms.has(atom.id)) fail('Note atom identities must be unique.');
          atoms.set(atom.id, note);
        }
        if (index === 0) roots.set(event.id, note);
      });
      oldGroup.filter((note) => !used.has(note)).forEach((note) => note.remove());
      cursor += length;
      processed.add(event.id);
    };
    const originalGroups = new Map<Element, string>();
    const chordMembers = new Set<Element>();
    for (const [anchorKey, nodes] of anchors) {
      if (!anchorKey.startsWith('event:') || nodes[0].parentElement !== measure) continue;
      originalGroups.set(nodes[0], anchorKey.slice('event:'.length));
      nodes.slice(1).forEach((node) => chordMembers.add(node));
    }
    const newEvents = measureEvents.filter((event) => !anchors.has('event:' + event.id));
    let added = false;
    const addEvents = (reference: Element | null) => {
      if (added) return;
      added = true;
      [...newEvents]
        .sort(
          (a, b) =>
            ticks(a.position.offset) - ticks(b.position.offset) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .forEach((event) => writeEvent(event, reference));
    };
    for (const element of originals) {
      if (chordMembers.has(element)) continue;
      if (
        element.tagName === 'barline' &&
        (element.getAttribute('location') ?? 'right') === 'right'
      )
        addEvents(element);
      const originalEventId = originalGroups.get(element);
      if (originalEventId) {
        const event = events.get(originalEventId);
        if (event) {
          if (event.position.measureId !== measureId)
            fail('Moving events between source measures is unsupported.');
          const marker = xml.createElement('serialization-anchor');
          measure.insertBefore(marker, element);
          writeEvent(event, marker);
          marker.remove();
        } else {
          moveTo(originalOffsets.get(element)!, element);
          const marker = xml.createElement('forward');
          scalar(marker, 'duration', duration(element));
          measure.insertBefore(marker, element);
          cursor += duration(element);
          anchors.get('event:' + originalEventId)!.forEach((note) => note.remove());
        }
      } else {
        moveTo(originalOffsets.get(element)!, element);
        if (element.tagName === 'backup') cursor -= duration(element);
        if (element.tagName === 'forward') cursor += duration(element);
      }
    }
    addEvents(null);
  }
  if (processed.size !== document.events.length) fail('An event has no source measure.');
  for (const tie of document.tieRelationships) {
    const start = document.events
      .flatMap((event) => (event.kind === 'pitched' ? event.notes : []))
      .find((note) => note.id === tie.startNoteAtomId);
    const stop = document.events
      .flatMap((event) => (event.kind === 'pitched' ? event.notes : []))
      .find((note) => note.id === tie.stopNoteAtomId);
    if (
      !start ||
      !stop ||
      start.pitch.step !== stop.pitch.step ||
      start.pitch.octave !== stop.pitch.octave ||
      (start.pitch.alter ?? 0) !== (stop.pitch.alter ?? 0)
    )
      fail('Tie endpoints require matching pitches.');
  }
  patchRelationships(document, xml, anchors, atoms, roots);
  const result = new XMLSerializer().serializeToString(xml);
  return result;
}

function duration(element: Element) {
  return integer(element.querySelector(':scope > duration')?.textContent, 'duration', 1);
}

function insert(parent: Element, child: Element) {
  const rank = noteOrder.indexOf(child.tagName);
  const reference = Array.from(parent.children).find(
    (candidate) => noteOrder.indexOf(candidate.tagName) > rank,
  );
  parent.insertBefore(child, reference ?? null);
}

function scalar(parent: Element, name: string, value?: string | number | null) {
  let node = parent.querySelector(':scope > ' + name);
  if (value == null) {
    node?.remove();
    return;
  }
  if (!node) {
    node = parent.ownerDocument.createElement(name);
    insert(parent, node);
  }
  if (
    typeof value === 'number'
      ? Number(node.textContent) !== value || !node.textContent?.trim()
      : node.textContent?.trim() !== value
  )
    node.textContent = String(value);
}

function toggle(parent: Element, name: string, wanted: boolean) {
  if (!wanted) parent.querySelector(':scope > ' + name)?.remove();
  else if (!parent.querySelector(':scope > ' + name))
    insert(parent, parent.ownerDocument.createElement(name));
}

function dots(note: Element, count: number) {
  const current = Array.from(note.querySelectorAll(':scope > dot'));
  current.slice(count).forEach((node) => node.remove());
  for (let index = current.length; index < count; index++)
    insert(note, note.ownerDocument.createElement('dot'));
}

function patchPitch(note: Element, atom: NoteAtom) {
  if (
    !['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(atom.pitch.step) ||
    !Number.isInteger(atom.pitch.octave) ||
    atom.pitch.octave < 0 ||
    atom.pitch.octave > 9 ||
    (atom.pitch.alter !== undefined && !Number.isFinite(atom.pitch.alter))
  )
    fail('Invalid pitch.');
  let pitch = note.querySelector(':scope > pitch');
  if (!pitch) {
    pitch = note.ownerDocument.createElement('pitch');
    insert(note, pitch);
  }
  // Pitch has its own fixed MusicXML child order.
  for (const [name, value] of [
    ['step', atom.pitch.step],
    ['alter', atom.pitch.alter],
    ['octave', atom.pitch.octave],
  ] as const) {
    let field = pitch.querySelector(':scope > ' + name);
    if (value === undefined) {
      field?.remove();
      continue;
    }
    if (!field) {
      field = note.ownerDocument.createElement(name);
      pitch.appendChild(field);
    }
    if (
      typeof value === 'number'
        ? Number(field.textContent) !== value || !field.textContent?.trim()
        : field.textContent?.trim() !== value
    )
      field.textContent = String(value);
  }
  const octave = pitch.querySelector('octave')!;
  const alter = pitch.querySelector('alter');
  if (alter && alter.nextElementSibling !== octave) pitch.insertBefore(alter, octave);
  scalar(note, 'accidental', atom.accidental);
  let fingering = note.querySelector(':scope > notations > technical > fingering');
  if (!atom.fingering) {
    fingering?.remove();
    return;
  }
  if (!/^[1-5]$/.test(atom.fingering)) fail('Unsupported fingering value.');
  if (!fingering) {
    const notations = notationContainer(note);
    let technical = notations.querySelector(':scope > technical');
    if (!technical) {
      technical = note.ownerDocument.createElement('technical');
      notations.appendChild(technical);
    }
    fingering = note.ownerDocument.createElement('fingering');
    technical.appendChild(fingering);
  }
  const text = fingering.textContent?.trim() ?? '';
  const circled = ['①', '②', '③', '④', '⑤'].indexOf(text);
  if ((circled >= 0 ? String(circled + 1) : text) !== atom.fingering)
    fingering.textContent = atom.fingering;
}

function notationContainer(note: Element) {
  let container = note.querySelector(':scope > notations');
  if (!container) {
    container = note.ownerDocument.createElement('notations');
    insert(note, container);
  }
  return container;
}

function patchRelationships(
  document: ScoreDocument,
  xml: XMLDocument,
  anchors: Map<string, Element[]>,
  atoms: Map<string, Element>,
  roots: Map<string, Element>,
) {
  const used = new Set<Element>();
  const slurNumbers = new Set(
    Array.from(xml.querySelectorAll('slur')).map((node) =>
      Number(node.getAttribute('number') ?? 1),
    ),
  );
  function nodeFor(old: Element[], note: Element, tag: string, type: string) {
    let node = old.find(
      (item) =>
        item.tagName === tag &&
        item.closest('note') === note &&
        (tag === 'beam' || item.getAttribute('type') === type),
    );
    if (!node) {
      node = xml.createElement(tag);
      if (tag === 'tie' || tag === 'beam') insert(note, node);
      else notationContainer(note).appendChild(node);
    }
    if (tag !== 'beam') node.setAttribute('type', type);
    used.add(node);
    return node;
  }
  function placement(node: Element, attribute: string, value?: string) {
    if (value) node.setAttribute(attribute, value);
    else node.removeAttribute(attribute);
  }
  for (const relationship of [...document.tieRelationships, ...document.slurRelationships]) {
    const start = atoms.get(relationship.startNoteAtomId),
      stop = atoms.get(relationship.stopNoteAtomId);
    if (!start || !stop || start.compareDocumentPosition(stop) & 2)
      fail('The relationship cannot be expressed safely in source order.');
  }
  for (const relationship of document.tieRelationships) {
    const old = anchors.get('tie:' + relationship.id) ?? [];
    const control = document.notationControls.find(
      (item): item is TieNotationControl =>
        item.kind === 'tieNotation' && item.tieId === relationship.id,
    );
    for (const [id, type] of [
      [relationship.startNoteAtomId, 'start'],
      [relationship.stopNoteAtomId, 'stop'],
    ] as const) {
      const note = atoms.get(id);
      if (!note) fail('A tie endpoint has no note atom.');
      nodeFor(old, note, 'tie', type);
      const override =
        type === 'start' && control?.kind === 'tieNotation' ? control.placement : undefined;
      if (
        !old.length ||
        old.some((item) => item.tagName === 'tied' && item.closest('note') === note) ||
        override
      ) {
        const tied = nodeFor(old, note, 'tied', type);
        if (type === 'start')
          placement(
            tied,
            'orientation',
            override === 'above' ? 'over' : override === 'below' ? 'under' : undefined,
          );
      }
    }
  }
  for (const relationship of document.slurRelationships) {
    const old = anchors.get('slur:' + relationship.id) ?? [];
    let number = old[0]?.getAttribute('number');
    if (!old.length) {
      let next = 1;
      while (slurNumbers.has(next)) next++;
      if (next > 16) fail('No safe MusicXML slur number is available.');
      number = String(next);
      slurNumbers.add(next);
    }
    const control = document.notationControls.find(
      (item): item is SlurNotationControl =>
        item.kind === 'slurNotation' && item.notationId === relationship.id,
    );
    for (const [id, type] of [
      [relationship.startNoteAtomId, 'start'],
      [relationship.stopNoteAtomId, 'stop'],
    ] as const) {
      const note = atoms.get(id);
      if (!note) fail('A slur endpoint has no note atom.');
      const slur = nodeFor(old, note, 'slur', type);
      if (number) slur.setAttribute('number', number);
      if (type === 'start')
        placement(
          slur,
          'placement',
          control?.kind === 'slurNotation' ? control.placement : undefined,
        );
    }
  }
  for (const relationship of document.beamRelationships) {
    const old = anchors.get('beam:' + relationship.id) ?? [];
    if (relationship.eventIds.length < 2) fail('A beam needs at least two events.');
    relationship.eventIds.forEach((id, index) => {
      const note = roots.get(id);
      if (!note || note.querySelector(':scope > rest')) fail('A beam endpoint must be pitched.');
      const beam = nodeFor(old, note, 'beam', '');
      if (!old.includes(beam)) beam.setAttribute('number', '1');
      const value =
        index === 0 ? 'begin' : index === relationship.eventIds.length - 1 ? 'end' : 'continue';
      if (beam.textContent?.trim() !== value) beam.textContent = value;
    });
  }
  for (const [key, nodes] of anchors) {
    if (/^(tie|slur|beam):/.test(key))
      nodes.filter((node) => !used.has(node)).forEach((node) => node.remove());
  }
}
