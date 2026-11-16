import {
  importEditorMusicXml,
  serializeEditorMusicXml,
  type EditorMusicXmlImport,
} from '@/lib/editor-musicxml';
import {
  documentTimelineGaps,
  type CommandResult,
  type ScoreDocument,
  type Voice,
  type VoiceId,
  type StaffId,
} from '@/lib/editor-domain';

type SemanticSnapshot = Pick<EditorMusicXmlImport, 'document' | 'source'> & { action: string };
export type EditorCommand = (document: ScoreDocument) => CommandResult;
export type EditorSessionState = {
  document: ScoreDocument | null;
  source: EditorMusicXmlImport['source'] | null;
  serializedXml: string | null;
  gaps: ReturnType<typeof documentTimelineGaps>;
  inputVoices: Voice[];
  canUndo: boolean;
  canRedo: boolean;
};
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
function reconcileInputVoices(document: ScoreDocument, inputVoices: readonly Voice[]): Voice[] {
  return inputVoices.filter(
    (voice) =>
      !document.voices.some(
        (persistent) => persistent.partId === voice.partId && persistent.number === voice.number,
      ),
  );
}
/** One atomic editor session; history stores semantic snapshots, never XML. */
export class EditorSession {
  private entries: SemanticSnapshot[] = [];
  private index = -1;
  private listeners = new Set<() => void>();
  private state: EditorSessionState = {
    document: null,
    source: null,
    serializedXml: null,
    gaps: [],
    inputVoices: [],
    canUndo: false,
    canRedo: false,
  };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(
    snapshot: SemanticSnapshot,
    serializedXml: string,
    inputVoices: readonly Voice[],
  ) {
    this.state = {
      document: immutable(snapshot.document),
      source: snapshot.source,
      serializedXml,
      gaps: documentTimelineGaps(snapshot.document),
      inputVoices: reconcileInputVoices(snapshot.document, inputVoices),
      canUndo: this.index > 0,
      canRedo: this.index < this.entries.length - 1,
    };
    this.listeners.forEach((listener) => listener());
  }
  private append(snapshot: SemanticSnapshot) {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(snapshot);
    if (this.entries.length > 50) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  loadMusicXml = (xml: string) => {
    const imported = importEditorMusicXml(xml);
    const serializedXml = serializeEditorMusicXml(imported);
    this.entries = [
      { document: immutable(imported.document), source: imported.source, action: 'load' },
    ];
    this.index = 0;
    this.publish(this.entries[0], serializedXml, []);
    return serializedXml;
  };
  applyCommand = (command: EditorCommand, action: string): CommandResult => {
    const { document, source } = this.state;
    if (!document || !source) return { success: false, error: 'No editor document is loaded.' };
    try {
      const result = command(document);
      if (!result.success) return result;
      const serializedXml = serializeEditorMusicXml({ document: result.document, source });
      const snapshot = { document: immutable(result.document), source, action };
      this.append(snapshot);
      this.publish(snapshot, serializedXml, this.state.inputVoices);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  replaceFromExternalMusicXml = (xml: string, action: string) => {
    const imported = importEditorMusicXml(xml);
    const serializedXml = serializeEditorMusicXml(imported);
    const snapshot = { document: immutable(imported.document), source: imported.source, action };
    this.append(snapshot);
    this.publish(snapshot, serializedXml, []);
    return serializedXml;
  };
  private restore(index: number) {
    const snapshot = this.entries[index];
    if (!snapshot) return null;
    const serializedXml = serializeEditorMusicXml(snapshot);
    this.index = index;
    this.publish(snapshot, serializedXml, this.state.inputVoices);
    return snapshot.document;
  }
  undo = () => (this.state.canUndo ? this.restore(this.index - 1) : null);
  redo = () => (this.state.canRedo ? this.restore(this.index + 1) : null);
  prepareVoice = (staffId?: StaffId) => {
    const document = this.state.document;
    const staff = staffId
      ? document?.staves.find((staff) => staff.id === staffId)
      : document?.staves[0];
    if (!document || !staff) return null;
    const voices = [...document.voices, ...this.state.inputVoices].filter(
      (voice) => voice.partId === staff.partId,
    );
    let number = 1;
    while (voices.some((voice) => voice.number === number)) number++;
    const voice: Voice = {
      id: `input:${staff.partId}:${number}` as VoiceId,
      partId: staff.partId,
      homeStaffId: staff.id,
      number,
      stemPolicy: 'automatic',
    };
    this.state = { ...this.state, inputVoices: [...this.state.inputVoices, voice] };
    this.listeners.forEach((listener) => listener());
    return voice;
  };
  discardInputVoice = (voiceId: VoiceId) => {
    this.state = {
      ...this.state,
      inputVoices: this.state.inputVoices.filter((voice) => voice.id !== voiceId),
    };
    this.listeners.forEach((listener) => listener());
  };
  clearDocument = () => {
    this.entries = [];
    this.index = -1;
    this.state = {
      document: null,
      source: null,
      serializedXml: null,
      gaps: [],
      inputVoices: [],
      canUndo: false,
      canRedo: false,
    };
    this.listeners.forEach((listener) => listener());
  };
}
