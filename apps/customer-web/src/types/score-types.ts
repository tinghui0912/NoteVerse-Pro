
export type Articulation = 'beam' | 'tie' | 'slur';
export type AccidentalValue = 'flat-flat' | 'flat' | 'natural' | 'sharp';

export type ParsedScoreEventType = 'note' | 'chord' | 'rest';

export type Duration =
  | 'durationWhole'
  | 'durationHalf'
  | 'durationQuarter'
  | 'durationEighth'
  | 'duration16th'
  | 'duration32nd';

export type EntityMeta = {
  id: string;
  /** All source XML ids represented by this UI entity, useful for chord-member SVG hit testing. */
  sourceIds?: string[];
  measureIndex: number;
  staveIndex: number;
  /** 1-based MusicXML voice value from the source `voice` element. */
  xmlVoice: number;
  entityIndex: number;
  /** Tick position within the measure, based on MusicXML divisions. */
  startTick: number;
};

export type Note = {
  type: 'note';
  pitch: string;
  duration: Duration;
  dotted?: boolean;
  stemDirection?: 'up' | 'down' | 'none';
  fingering?: string;
  accidental?: AccidentalValue | null;
  articulation?: Articulation[];
  meta?: EntityMeta;
};

export type Chord = {
  type: 'chord';
  pitches: string[];
  duration: Duration;
  dotted?: boolean;
  stemDirection?: 'up' | 'down' | 'none';
  /** Fingering values aligned by index with `pitches`. */
  fingerings?: string[];
  /** Accidental values aligned by index with `pitches`; null clears an existing explicit accidental. */
  accidentals?: Array<AccidentalValue | null | undefined>;
  articulation?: Articulation[];
  meta?: EntityMeta;
};

export type Rest = {
  type: 'rest';
  duration: Duration;
  dotted?: boolean;
  meta?: EntityMeta;
};

export type ParsedScoreEvent = Note | Chord | Rest;

export type Voice = {
  name: string;
  events: ParsedScoreEvent[];
};

export type Stave = {
  clef: 'treble' | 'bass';
  name: string;
  voices: Voice[];
};

export type Measure = {
  number: number;
  staves: Stave[];
};

export type TieConnection = {
  /** Connected entity id at the other end of the tie. */
  partnerId: string;
  /** Whether this entity is the rendered tie start or stop. */
  type: 'start' | 'stop';
  /** Concrete XML note id inside this entity, used for chord-member connections. */
  sourceId?: string;
  /** Concrete XML note id inside the partner entity. */
  partnerSourceId?: string;
};

export type SlurConnection = {
  slurId: string;
  /** Whether this entity is the rendered slur start or stop. */
  type: 'start' | 'stop';
  /** All entity ids represented by this slur. */
  partnerIds: string[];
  /** Concrete XML note id inside this entity, used for chord-member connections. */
  sourceId?: string;
  /** Concrete XML note ids represented by this slur. */
  partnerSourceIds?: string[];
};

export type BeamConnection = {
  beamId: string;
  /** All entity ids represented by this beam. */
  noteIds: string[];
};

export type NoteConnections = {
  ties: TieConnection[];
  slurs: SlurConnection[];
  beams: BeamConnection[];
};

export type EntityInfo = {
  /** Pitch text such as `A5`, or a localized rest label. */
  pitch: string;
  /** 1-based measure number. */
  measureNumber: number;
  /** Staff display label. */
  staveLabel: string;
  /** 1-based voice number. */
  voiceNumber: number;
  /** 1-based entity position within the voice. */
  position: number;
};

export type ConnectionData = {
  noteConnections: Map<string, NoteConnections>;
  /** Entity id to connection detail display metadata. */
  entityInfoMap: Map<string, EntityInfo>;
};

export type ScoreData = {
  measures: Measure[];
  mainTitle?: string;
  subtitle?: string;
  composer?: string;
  lyricist?: string;
  copyright?: string;
  keySignature?: string;
  timeSignature?: string;
  tempo?: string;
  measureCount?: number;
  noteCount?: number;
  connections?: ConnectionData;
};

export type TimelineInsertLocation = {
  measureIndex: number;
  staveIndex: number;
  /** 1-based MusicXML voice value from the source `voice` element. */
  xmlVoice: number;
  /** Tick position within the measure; primary placement field for timeline insertions. */
  tick: number;
};

export type AddLocation = TimelineInsertLocation;

export type EntityLocation = {
  measureIndex: number;
  staveIndex: number;
  /** 1-based MusicXML voice value from the source `voice` element. */
  xmlVoice: number;
  entityIndex: number;
};
