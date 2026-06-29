
export type Articulation = 'beam' | 'tie' | 'slur';

export type ScoreEntityType = 'note' | 'chord' | 'rest' | 'blank';

// 时值类型（精确定义）
export type Duration =
  | 'durationWhole'    // 全音符
  | 'durationHalf'     // 二分音符
  | 'durationQuarter'  // 四分音符
  | 'durationEighth'   // 八分音符
  | 'duration16th'     // 十六分音符
  | 'duration32nd';    // 三十二分音符

// 实体位置元数据
export type EntityMeta = {
  id: string;
  /** All source XML ids represented by this UI entity, useful for chord-member SVG hit testing. */
  sourceIds?: string[];
  measureIndex: number;
  staveIndex: number;
  /** XML voice 值 (1-based)，直接来自 MusicXML 的 voice 元素 */
  xmlVoice: number;
  entityIndex: number;
  startTick: number;  // 在小节内的时间位置（基于 divisions）
};

export type Note = {
  type: 'note';
  pitch: string;
  duration: Duration;
  dotted?: boolean;
  stemDirection?: 'up' | 'down' | 'none';
  fingering?: string;
  articulation?: Articulation[];
  meta?: EntityMeta;
};

export type Chord = {
  type: 'chord';
  pitches: string[];
  duration: Duration;
  dotted?: boolean;
  stemDirection?: 'up' | 'down' | 'none';
  fingerings?: string[];  // 每个音符的指法，与 pitches 数组对应
  articulation?: Articulation[];
  meta?: EntityMeta;
};

export type Rest = {
  type: 'rest';
  duration: Duration;
  dotted?: boolean;
  meta?: EntityMeta;
};

export type Blank = {
  type: 'blank';
  duration: Duration;
  dotted?: boolean;
  meta?: EntityMeta;
};


export type ScoreEntity = Note | Chord | Rest | Blank;

export type Voice = {
  name: string;
  notes: ScoreEntity[];
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

// 连线信息类型
export type TieConnection = {
  partnerId: string;        // 连接的另一个音符 ID
  type: 'start' | 'stop';   // 连音线起点或终点
  sourceId?: string;        // 当前实体内的具体 XML note id（用于和弦成员级连接）
  partnerSourceId?: string; // 对端实体内的具体 XML note id
};

export type SlurConnection = {
  slurId: string;           // 连奏线 ID
  type: 'start' | 'stop';   // 连奏线起点或终点
  partnerIds: string[];     // 连奏线上所有音符 ID
  sourceId?: string;        // 当前实体内的具体 XML note id（用于和弦成员级连接）
  partnerSourceIds?: string[]; // 连奏线上所有具体 XML note id
};

export type BeamConnection = {
  beamId: string;           // 连音符 ID
  noteIds: string[];        // 连音符上所有音符 ID
};

export type NoteConnections = {
  ties: TieConnection[];
  slurs: SlurConnection[];
  beams: BeamConnection[];
};

// 实体信息，用于显示连线详情
export type EntityInfo = {
  pitch: string;           // 音高 (如 "A5") 或 "休止符"
  measureNumber: number;   // 小节号 (1-based)
  staveLabel: string;      // 谱表名称 (如 "高音谱表")
  voiceNumber: number;     // 声部号 (1-based)
  position: number;        // 位置 (1-based)
};

export type ConnectionData = {
  noteConnections: Map<string, NoteConnections>;
  entityInfoMap: Map<string, EntityInfo>;  // entityId -> 实体信息
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
  /** XML voice 值 (1-based)，直接来自 MusicXML 的 voice 元素 */
  xmlVoice: number;
  /** 小节内 tick 位置；新 timeline 插入的主定位字段 */
  tick: number;
};

export type AddLocation = TimelineInsertLocation;

export type EntityLocation = {
  measureIndex: number;
  staveIndex: number;
  /** XML voice 值 (1-based)，直接来自 MusicXML 的 voice 元素 */
  xmlVoice: number;
  entityIndex: number;
};
