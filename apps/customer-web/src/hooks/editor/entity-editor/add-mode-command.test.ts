import { describe, expect, it } from 'vitest';

import {
  applyAddModeInsertCommandToDomain,
  createAddModeInsertCommand,
  createAddModeInputDuration,
  createAddModeInputDurationFromDuration,
  createDefaultAddModeInputDuration,
  createDefaultAddModeInsertCommand,
  createDefaultAddModePitchedEventCommand,
} from './add-mode-command';
import type { EventId } from '@/lib/editor-domain';
import {
  createTestScoreDocument,
  testMeasureId,
  testStaffId,
  testVoiceId,
} from '@/lib/editor-domain/test-fixtures';

describe('add-mode insert command adapter', () => {
  it('creates the default explicit-rest command without hard-coding the entity in the hook', () => {
    const command = createDefaultAddModeInsertCommand();

    expect(createDefaultAddModeInputDuration()).toEqual(command.inputDuration);
    expect(command).toEqual({
      kind: 'insertExplicitRest',
      inputDuration: {
        kind: 'inputDuration',
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: {
            base: 'quarter',
            dots: 0,
          },
        },
      },
    });
  });

  it('creates explicit add-mode input duration values', () => {
    const command = {
      kind: 'insertExplicitRest' as const,
      inputDuration: createAddModeInputDuration({
        timelineDuration: { numerator: 2, denominator: 1 },
        notation: {
          base: 'half',
          dots: 1,
        },
      }),
    };

    expect(command.inputDuration).toEqual({
      kind: 'inputDuration',
      rhythm: {
        timelineDuration: { numerator: 2, denominator: 1 },
        notation: {
          base: 'half',
          dots: 1,
        },
      },
    });
  });

  it('creates insert commands from visible add-mode input state', () => {
    const inputDuration = createAddModeInputDurationFromDuration('durationEighth');

    expect(createAddModeInsertCommand({
      input: {
        kind: 'rest',
        pitch: { step: 'C', octave: 4 },
      },
      inputDuration,
    })).toEqual({
      kind: 'insertExplicitRest',
      inputDuration,
    });

    expect(createAddModeInsertCommand({
      input: {
        kind: 'pitched',
        pitch: { step: 'D', octave: 5 },
      },
      inputDuration,
    })).toEqual({
      kind: 'insertPitchedEvent',
      inputDuration,
      pitch: { step: 'D', octave: 5 },
    });
  });

  it('maps UI duration selections to quarter-note timeline units', () => {
    expect(createAddModeInputDurationFromDuration('durationHalf')).toEqual({
      kind: 'inputDuration',
      rhythm: {
        timelineDuration: { numerator: 2, denominator: 1 },
        notation: {
          base: 'half',
          dots: 0,
        },
      },
    });
    expect(createAddModeInputDurationFromDuration('durationEighth')).toEqual({
      kind: 'inputDuration',
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 2 },
        notation: {
          base: 'eighth',
          dots: 0,
        },
      },
    });
  });

  it('applies an explicit rest insert command to the editor-domain document', () => {
    const result = applyAddModeInsertCommandToDomain({
      document: createTestScoreDocument(),
      eventId: 'rest-1' as EventId,
      voiceId: testVoiceId,
      staffId: testStaffId,
      position: {
        measureId: testMeasureId,
        offset: { numerator: 1, denominator: 1 },
      },
      command: {
        kind: 'insertExplicitRest',
        inputDuration: createAddModeInputDurationFromDuration('durationHalf'),
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events).toEqual([
      {
        id: 'rest-1',
        kind: 'explicitRest',
        voiceId: testVoiceId,
        staffId: testStaffId,
        position: {
          measureId: testMeasureId,
          offset: { numerator: 1, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 2, denominator: 1 },
          notation: { base: 'half', dots: 0 },
        },
      },
    ]);
  });

  it('applies a pitched-event insert command to the editor-domain document', () => {
    const command = createDefaultAddModePitchedEventCommand();
    const result = applyAddModeInsertCommandToDomain({
      document: createTestScoreDocument(),
      eventId: 'note-1' as EventId,
      voiceId: testVoiceId,
      staffId: testStaffId,
      position: {
        measureId: testMeasureId,
        offset: { numerator: 1, denominator: 1 },
      },
      command,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events).toEqual([
      {
        id: 'note-1',
        kind: 'pitched',
        voiceId: testVoiceId,
        staffId: testStaffId,
        position: {
          measureId: testMeasureId,
          offset: { numerator: 1, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [
          {
            id: 'note-1-note-1',
            pitch: {
              step: 'C',
              octave: 4,
            },
          },
        ],
      },
    ]);
  });

});
