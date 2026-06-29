import { describe, expect, it } from 'vitest';
import type { ScoreData } from '@/types/score-types';
import {
  deriveEditorTracks,
  getEditorTrackId,
  getNextVoiceNumber,
  getNextVoiceNumberFromScore,
  parseVoiceNumber,
} from './tracks';

describe('editor tracks view model', () => {
  it('uses stable ids and parses MusicXML voice labels', () => {
    expect(getEditorTrackId(0, 2)).toBe('voice-2');
    expect(parseVoiceNumber('voiceLabel 3')).toBe(3);
  });

  it('derives one global track per MusicXML voice across the score', () => {
    const scoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                {
                  name: 'voiceLabel 1',
                  notes: [{ type: 'rest', duration: 'durationQuarter' }],
                },
                {
                  name: 'voiceLabel 2',
                  notes: [],
                },
              ],
            },
          ],
        },
        {
          number: 2,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                {
                  name: 'voiceLabel 1',
                  notes: [{ type: 'note', pitch: 'C4', duration: 'durationQuarter' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const tracks = deriveEditorTracks(scoreData);

    expect(tracks.map((track) => track.id)).toEqual(['voice-1', 'voice-2']);
    expect(tracks[0].entityCount).toBe(2);
    expect(tracks[1].entityCount).toBe(0);
  });

  it('merges the same voice number across staves into one layer', () => {
    const scoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [{ name: 'voiceLabel 1', notes: [{ type: 'note', pitch: 'C4', duration: 'durationQuarter' }] }],
            },
            {
              clef: 'bass',
              name: 'bassClef',
              voices: [{ name: 'voiceLabel 1', notes: [{ type: 'note', pitch: 'C3', duration: 'durationQuarter' }] }],
            },
          ],
        },
      ],
    };

    const tracks = deriveEditorTracks(scoreData);

    expect(tracks.map((track) => track.id)).toEqual(['voice-1']);
    expect(tracks[0].entityCount).toBe(2);
  });

  it('orders tracks by global voice number', () => {
    const scoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                { name: 'voiceLabel 1', notes: [] },
                { name: 'voiceLabel 3', notes: [] },
              ],
            },
            {
              clef: 'bass',
              name: 'bassClef',
              voices: [{ name: 'voiceLabel 2', notes: [] }],
            },
          ],
        },
      ],
    };

    expect(deriveEditorTracks(scoreData).map((track) => track.id)).toEqual([
      'voice-1',
      'voice-2',
      'voice-3',
    ]);
  });

  it('picks the next global voice number from current tracks', () => {
    const tracks = [
      { id: 'voice-1', staffIndex: 0, xmlVoice: 1, label: 'Voice 1', color: '#000', entityCount: 1, measureCount: 1 },
      { id: 'voice-3', staffIndex: 0, xmlVoice: 3, label: 'Voice 3', color: '#000', entityCount: 0, measureCount: 0 },
    ];

    expect(getNextVoiceNumber(tracks, 0)).toBe(4);
  });

  it('picks the next voice number from every measure in the target staff', () => {
    const scoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                { name: 'voiceLabel 1', notes: [] },
                { name: 'voiceLabel 2', notes: [] },
              ],
            },
          ],
        },
        {
          number: 2,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [
                { name: 'voiceLabel 1', notes: [] },
                { name: 'voiceLabel 3', notes: [] },
              ],
            },
          ],
        },
      ],
    };

    expect(getNextVoiceNumberFromScore(scoreData, 0)).toBe(4);
  });

  it('picks the next global voice number when no staff is specified', () => {
    const scoreData: ScoreData = {
      measures: [
        {
          number: 1,
          staves: [
            {
              clef: 'treble',
              name: 'trebleClef',
              voices: [{ name: 'voiceLabel 1', notes: [] }],
            },
            {
              clef: 'bass',
              name: 'bassClef',
              voices: [{ name: 'voiceLabel 2', notes: [] }],
            },
          ],
        },
      ],
    };

    expect(getNextVoiceNumberFromScore(scoreData)).toBe(3);
  });
});
