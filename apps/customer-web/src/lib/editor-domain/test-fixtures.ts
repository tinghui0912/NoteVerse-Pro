import type {
  MeasureId,
  NotationControl,
  PartId,
  ScoreDocument,
  ScoreDocumentId,
  StaffId,
  VoiceId,
  VoiceEvent,
  BeamRelationship,
  TieRelationship,
  SlurRelationship,
} from './index';

const testPartId = 'part-1' as PartId;
export const testStaffId = 'staff-1' as StaffId;
export const testVoiceId = 'voice-1' as VoiceId;
export const testMeasureId = 'measure-1' as MeasureId;

export function createTestScoreDocument(params: {
  events?: VoiceEvent[];
  beamRelationships?: BeamRelationship[];
  tieRelationships?: TieRelationship[];
  slurRelationships?: SlurRelationship[];
  notationControls?: NotationControl[];
} = {}): ScoreDocument {
  return {
    schemaVersion: 1,
    id: 'score-document-1' as ScoreDocumentId,
    metadata: {notationTitle:null,subtitle:null,composer:null,lyricist:null,copyright:null,tempoNotation:null},
    parts: [{ id: testPartId, name: 'Piano' }],
    staves: [{ id: testStaffId, partId: testPartId, index: 0 }],
    voices: [{ id: testVoiceId, partId: testPartId, homeStaffId: testStaffId, number:1, stemPolicy: 'automatic' }],
    measures: [{ id: testMeasureId, partId:testPartId, attributes:{meter:{beats:4,beatType:4}}, number: 1 }],
    events: params.events ?? [],
    beamRelationships: params.beamRelationships ?? [],
    tieRelationships: params.tieRelationships ?? [],
    slurRelationships: params.slurRelationships ?? [],
    notationControls: params.notationControls ?? [],
  };
}
