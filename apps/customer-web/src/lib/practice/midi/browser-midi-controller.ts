import type { PracticeTimebase, SessionTime } from '@/lib/practice/kernel/timebase';
export type MidiAttackFact = Readonly<{
  sessionTime: SessionTime;
  noteNumber: number;
  confidence: 1;
}>;

export function isMidiNoteNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 127;
}

export type ParsedMidiMessage = {
  type: 'NOTE_ON' | 'NOTE_OFF';
  noteNumber: number;
  velocity: number;
};

export function parseMidiMessage(data: Uint8Array): ParsedMidiMessage | null {
  if (data.length < 3) {
    return null;
  }
  const status = data[0] & 0xf0;
  const noteNumber = data[1];
  const velocity = data[2];
  if (!isMidiNoteNumber(noteNumber) || velocity > 127) return null;

  if (status === 0x90 && velocity > 0) {
    return {
      type: 'NOTE_ON',
      noteNumber,
      velocity,
    };
  }
  if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    return {
      type: 'NOTE_OFF',
      noteNumber,
      velocity: 0,
    };
  }
  return null;
}

export type BrowserMidiControllerOptions = {
  access: MIDIAccess;
  timebase: PracticeTimebase;
  onAttack?: (attack: MidiAttackFact) => void;
  onMidiNote?: (note: {
    type: 'NOTE_ON' | 'NOTE_OFF';
    noteNumber: number;
    velocity: number;
    sessionTime: SessionTime;
  }) => void;
  onStateChange?: (state: BrowserMidiState) => void;
};
export type MidiNoteFact = ParsedMidiMessage & { sessionTime: SessionTime };

export type BrowserMidiState = {
  isSupported: boolean;
  hasPermission: boolean | null;
  connectedInputCount: number;
  isRunning: boolean;
};

export class MidiNoConnectedInputError extends Error {
  readonly code = 'NO_CONNECTED_INPUT' as const;
  constructor(message = 'NO_CONNECTED_INPUT') {
    super(message);
    this.name = 'MidiNoConnectedInputError';
  }
}

export class BrowserMidiController {
  private readonly timebase: PracticeTimebase;
  private readonly onAttack?: (attack: MidiAttackFact) => void;
  private readonly onMidiNote?: (note: {
    type: 'NOTE_ON' | 'NOTE_OFF';
    noteNumber: number;
    velocity: number;
    sessionTime: SessionTime;
  }) => void;
  private readonly onStateChange?: (state: BrowserMidiState) => void;

  private midiAccess: MIDIAccess | null = null;
  private isRunning = false;
  private isSupported: boolean;
  private hasPermission: boolean | null = null;
  private connectedInputCount = 0;

  private readonly access: MIDIAccess;
  private readonly boundInputs = new Set<MIDIInput>();
  private readonly stateChanged = () => { this.syncInputs(this.access); this.notifyState(); };
  private readonly message = (event: MIDIMessageEvent) => { if (event.data) this.dispatchMidiData(event.data, event.timeStamp); };

  constructor(options: BrowserMidiControllerOptions) {
    this.timebase = options.timebase;
    this.onAttack = options.onAttack;
    this.onMidiNote = options.onMidiNote;
    this.onStateChange = options.onStateChange;
    this.access = options.access;
    this.isSupported = true;
    this.hasPermission = true;
  }

  getState(): BrowserMidiState {
    return {
      isSupported: this.isSupported,
      hasPermission: this.hasPermission,
      connectedInputCount: this.connectedInputCount,
      isRunning: this.isRunning,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const access = this.access;
    this.midiAccess = access;
    this.bindAccess(access);
    this.syncInputs(access);

    if (this.connectedInputCount === 0) {
      this.isRunning = false;
      this.notifyState();
      throw new MidiNoConnectedInputError('NO_CONNECTED_INPUT');
    }

    this.isRunning = true;
    this.notifyState();
  }

  stop(): void {
    if (!this.isRunning && !this.midiAccess) {
      return;
    }
    this.unbindAccess();
    this.isRunning = false;
    this.notifyState();
  }

  dispose(): void {
    this.stop();
    this.midiAccess = null;
  }

  /**
   * Directly feed a MIDI message byte array (useful for unit testing without physical device).
   */
  dispatchMidiData(data: Uint8Array, rawTimestampMs?: number): void {
    if (!this.isRunning) {
      return;
    }
    const parsed = parseMidiMessage(data);
    if (!parsed) {
      return;
    }

    const nowMs = rawTimestampMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const sessionTime = this.timebase.runtimeToSessionTime(nowMs);

    this.onMidiNote?.({
      ...parsed,
      sessionTime,
    });

    if (parsed.type === 'NOTE_ON') {
      this.handleNoteOn(parsed.noteNumber, sessionTime);
    }
  }

  private handleNoteOn(noteNumber: number, sessionTime: SessionTime): void {
    // A physical NOTE_ON fact; mode-specific consumers own grouping/evaluation.
    this.onAttack?.({
      sessionTime,
      noteNumber,
      confidence: 1,
    });

  }

  private bindAccess(access: MIDIAccess): void { access.addEventListener('statechange', this.stateChanged); }
  private unbindAccess(): void {
    this.midiAccess?.removeEventListener('statechange', this.stateChanged);
    for (const input of this.boundInputs) input.removeEventListener('midimessage', this.message);
    this.boundInputs.clear();
  }
  private syncInputs(access: MIDIAccess): void {
    for (const input of this.boundInputs) input.removeEventListener('midimessage', this.message);
    this.boundInputs.clear();
    access.inputs.forEach(input => {
      if (input.state !== 'connected') return;
      input.addEventListener('midimessage', this.message); this.boundInputs.add(input);
    });
    this.connectedInputCount = this.boundInputs.size;
  }

  private notifyState(): void {
    this.onStateChange?.(this.getState());
  }
}
