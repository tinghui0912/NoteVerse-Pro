import { describe, expect, it } from 'vitest';

import type { EventId, NotationId, TieId } from './model';
import {
  getEventNotationControl,
  getEventStemDirectionOverride,
  type EventNotationControl,
  type NotationControl,
} from './notation-model';

describe('editor domain notation model', () => {
  it('keeps notation controls separate from voice event identity', () => {
    const stem: NotationControl = {
      kind: 'eventNotation',
      eventId: 'event-1' as EventId,
      stemDirection: 'up',
    };
    const tie: NotationControl = {
      kind: 'tieNotation',
      tieId: 'tie-1' as TieId,
      placement: 'above',
    };
    const slur: NotationControl = {
      kind: 'slurNotation',
      notationId: 'slur-1' as NotationId,
      placement: 'below',
    };
    const beam: NotationControl = {
      kind: 'beamNotation',
      notationId: 'beam-1' as NotationId,
      eventIds: ['event-1' as EventId, 'event-2' as EventId],
      direction: 'down',
    };

    expect(stem).toMatchObject({ kind: 'eventNotation', eventId: 'event-1' });
    expect(tie).toMatchObject({ kind: 'tieNotation', tieId: 'tie-1' });
    expect(slur).toMatchObject({ kind: 'slurNotation', notationId: 'slur-1' });
    expect(beam.eventIds).toEqual(['event-1', 'event-2']);
  });

  it('models automatic engraving as missing override state', () => {
    const automaticStem: EventNotationControl = {
      kind: 'eventNotation',
      eventId: 'event-1' as EventId,
    };
    const explicitNoStem: EventNotationControl = {
      kind: 'eventNotation',
      eventId: 'event-2' as EventId,
      stemDirection: 'none',
    };
    const explicitDoubleStem: EventNotationControl = {
      kind: 'eventNotation',
      eventId: 'event-3' as EventId,
      stemDirection: 'double',
    };

    expect(automaticStem.stemDirection).toBeUndefined();
    expect(explicitNoStem.stemDirection).toBe('none');
    expect(explicitDoubleStem.stemDirection).toBe('double');
  });

  it('reads event-level notation controls through a single helper', () => {
    const controls: NotationControl[] = [
      {
        kind: 'eventNotation',
        eventId: 'event-1' as EventId,
        stemDirection: 'up',
      },
      {
        kind: 'slurNotation',
        notationId: 'slur-1' as NotationId,
        placement: 'below',
      },
    ];

    expect(getEventNotationControl(controls, 'event-1' as EventId)).toMatchObject({
      kind: 'eventNotation',
      stemDirection: 'up',
    });
    expect(getEventStemDirectionOverride(controls, 'event-1' as EventId)).toBe('up');
    expect(getEventStemDirectionOverride(controls, 'missing-event' as EventId)).toBeUndefined();
  });
});
