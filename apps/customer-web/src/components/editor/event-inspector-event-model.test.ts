import { describe, expect, it } from 'vitest';

import type { ParsedScoreEvent, Rest } from '@/types/score-types';
import { createDefaultEditableEvent } from './event-inspector-editable-event';
import {
  createInspectorEditState,
  toInspectorEditStateFromEditableEvent,
} from './event-inspector-event-model';

describe('event inspector save projection', () => {
  it('projects explicit rest edits as domain drafts', () => {
    const original: Rest = {
      type: 'rest',
      duration: 'durationQuarter',
      meta: {
        id: 'rest-1',
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 1,
        entityIndex: 0,
        startTick: 0,
      },
    };

    const state = toInspectorEditStateFromEditableEvent(original, {
      ...createDefaultEditableEvent(),
      duration: 'durationHalf',
    });

    expect(state.draft).toMatchObject({
      kind: 'explicitRest',
      eventId: 'rest-1',
      rhythm: {
        timelineDuration: { numerator: 2, denominator: 1 },
        notation: { base: 'half', dots: 0 },
      },
    });
  });

  it('keeps imported stem direction as a notation override', () => {
    const original: ParsedScoreEvent = {
      type: 'note',
      pitch: 'C4',
      duration: 'durationQuarter',
      stemDirection: 'up',
    };

    const state = createInspectorEditState(original);

    expect(state.notationOverrides.stemDirection).toBe('up');
  });

  it('treats automatic stem choice as a missing notation override', () => {
    const original: ParsedScoreEvent = {
      type: 'note',
      pitch: 'C4',
      duration: 'durationQuarter',
      stemDirection: 'none',
    };

    const state = createInspectorEditState(original);

    expect(state.notationOverrides.stemDirection).toBeUndefined();
  });
});
