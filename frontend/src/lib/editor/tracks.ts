import type { ScoreData } from '@/types/score-types';

export type EditorTrack = {
  id: string;
  staffIndex: number;
  xmlVoice: number;
  label: string;
  color: string;
  entityCount: number;
  measureCount: number;
};

const TRACK_COLORS = [
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#dc2626',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#4f46e5',
];

export function getEditorTrackId(_staffIndex: number, xmlVoice: number): string {
  return `voice-${xmlVoice}`;
}

export function parseVoiceNumber(voiceName: string): number {
  const match = voiceName.match(/voiceLabel\s*(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 1;
}

export function getTrackColor(_staffIndex: number, xmlVoice: number): string {
  const colorIndex = Math.abs(xmlVoice - 1) % TRACK_COLORS.length;
  return TRACK_COLORS[colorIndex];
}

export function getNextVoiceNumber(tracks: EditorTrack[], _staffIndex: number): number {
  const voiceNumbers = tracks
    .map((track) => track.xmlVoice);

  return voiceNumbers.length > 0 ? Math.max(...voiceNumbers) + 1 : 1;
}

export function getNextVoiceNumberFromScore(scoreData: ScoreData | null, staffIndex?: number): number {
  if (!scoreData) return 1;

  const voiceNumbers = new Set<number>();
  scoreData.measures.forEach((measure) => {
    const staves = staffIndex === undefined ? measure.staves : [measure.staves[staffIndex]].filter(Boolean);
    staves.forEach((stave) => {
      stave.voices.forEach((voice) => {
        voiceNumbers.add(parseVoiceNumber(voice.name));
      });
    });
  });

  return voiceNumbers.size > 0 ? Math.max(...voiceNumbers) + 1 : 1;
}

export function deriveEditorTracks(scoreData: ScoreData | null): EditorTrack[] {
  if (!scoreData) return [];

  const tracks = new Map<string, EditorTrack>();

  scoreData.measures.forEach((measure) => {
    measure.staves.forEach((stave, staffIndex) => {
      stave.voices.forEach((voice) => {
        const xmlVoice = parseVoiceNumber(voice.name);
        const id = getEditorTrackId(staffIndex, xmlVoice);
        const existing = tracks.get(id);

        if (existing) {
          existing.entityCount += voice.notes.length;
          existing.measureCount += voice.notes.length > 0 ? 1 : 0;
          return;
        }

        tracks.set(id, {
          id,
          staffIndex,
          xmlVoice,
          label: `Voice ${xmlVoice}`,
          color: getTrackColor(staffIndex, xmlVoice),
          entityCount: voice.notes.length,
          measureCount: voice.notes.length > 0 ? 1 : 0,
        });
      });
    });
  });

  return Array.from(tracks.values()).sort((left, right) => {
    return left.xmlVoice - right.xmlVoice;
  });
}
