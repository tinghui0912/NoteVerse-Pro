import type { ScoreDocument, Voice, VoiceId, PartId } from '@/lib/editor-domain';
export type EditorTrack = {
  id: string;
  voiceId: VoiceId;
  partId: PartId;
  staffIndex: number;
  xmlVoice: number;
  label: string;
  color: string;
  entityCount: number;
  measureCount: number;
};
const colors = [
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#dc2626',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#4f46e5',
];
export function getTrackColor(_staffIndex: number, number: number) {
  return colors[(number - 1) % colors.length];
}
export function deriveEditorTracks(
  document: ScoreDocument | null,
  inputVoices: Voice[] = [],
): EditorTrack[] {
  if (!document) return [];
  return [...document.voices, ...inputVoices]
    .map((voice) => {
      const events = document.events.filter((event) => event.voiceId === voice.id);
      const staffIndex = document.staves.findIndex((staff) => staff.id === voice.homeStaffId);
      if (staffIndex < 0) throw new Error('The voice requires a declared staff.');
      return {
        id: voice.id,
        voiceId: voice.id,
        partId: voice.partId,
        staffIndex,
        xmlVoice: voice.number,
        label: `Voice ${voice.number}`,
        color: getTrackColor(staffIndex, voice.number),
        entityCount: events.length,
        measureCount: new Set(events.map((event) => event.position.measureId)).size,
      };
    })
    .sort((a, b) => a.partId.localeCompare(b.partId) || a.xmlVoice - b.xmlVoice);
}
