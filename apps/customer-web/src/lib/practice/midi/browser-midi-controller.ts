import type {
  PracticeTimebase,
  SessionTime,
} from '../local-core/timebase';
import type { CapturedAttack } from '../local-core/evidence';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiNoteToPitch(midiNote: number): string {
  const octave = Math.floor(midiNote / 12) - 1;
  const noteIndex = ((midiNote % 12) + 12) % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export type ParsedMidiMessage = {
  type: 'NOTE_ON' | 'NOTE_OFF';
  noteNumber: number;
  pitch: string;
  velocity: number;
};

export function parseMidiMessage(data: Uint8Array): ParsedMidiMessage | null {
  if (data.length < 3) {
    return null;
  }
  const status = data[0] & 0xf0;
  const noteNumber = data[1];
  const velocity = data[2];
  if (noteNumber > 127 || velocity > 127) return null;

  if (status === 0x90 && velocity > 0) {
    return {
      type: 'NOTE_ON',
      noteNumber,
      pitch: midiNoteToPitch(noteNumber),
      velocity,
    };
  }
  if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    return {
      type: 'NOTE_OFF',
      noteNumber,
      pitch: midiNoteToPitch(noteNumber),
      velocity: 0,
    };
  }
  return null;
}

export type BrowserMidiControllerOptions = {
  timebase: PracticeTimebase;
  onCapturedAttack?: (attack: CapturedAttack) => void;
  onMidiNote?: (note: {
    type: 'NOTE_ON' | 'NOTE_OFF';
    noteNumber: number;
    pitch: string;
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

type NavigatorWithMidi = Navigator & {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccess>;
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
  private readonly onCapturedAttack?: (attack: CapturedAttack) => void;
  private readonly onMidiNote?: (note: {
    type: 'NOTE_ON' | 'NOTE_OFF';
    noteNumber: number;
    pitch: string;
    velocity: number;
    sessionTime: SessionTime;
  }) => void;
  private readonly onStateChange?: (state: BrowserMidiState) => void;

  private midiAccess: MIDIAccess | null = null;
  private isRunning = false;
  private isSupported: boolean;
  private hasPermission: boolean | null = null;
  private connectedInputCount = 0;

  private startGeneration = 0;

  constructor(options: BrowserMidiControllerOptions) {
    this.timebase = options.timebase;
    this.onCapturedAttack = options.onCapturedAttack;
    this.onMidiNote = options.onMidiNote;
    this.onStateChange = options.onStateChange;
    this.isSupported =
      typeof navigator !== 'undefined' &&
      typeof (navigator as NavigatorWithMidi).requestMIDIAccess === 'function';
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

    const generation = ++this.startGeneration;
    const requestMIDIAccess = (typeof navigator !== 'undefined'
      ? (navigator as NavigatorWithMidi).requestMIDIAccess
      : undefined);

    if (typeof requestMIDIAccess !== 'function') {
      this.isSupported = false;
      this.notifyState();
      throw new Error('Web MIDI is not supported in this browser environment.');
    }

    let access: MIDIAccess;
    try {
      access = await requestMIDIAccess.call(navigator, { sysex: false });
      if (generation !== this.startGeneration) throw new Error('MIDI_START_CANCELLED');
      this.midiAccess = access;
      this.hasPermission = true;
    } catch (err) {
      this.hasPermission = false;
      this.isRunning = false;
      this.notifyState();
      throw err;
    }

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
    this.startGeneration++;
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
      this.handleNoteOn(parsed.pitch, sessionTime);
    }
  }

  private handleNoteOn(pitch: string, sessionTime: SessionTime): void {
    // A physical NOTE_ON fact; mode-specific consumers own grouping/evaluation.
    this.onCapturedAttack?.({
      captureTime: sessionTime,
      pitch,
      confidence: 1,
      source: 'MIDI',
    });

  }

  private bindAccess(access: MIDIAccess): void {
    access.onstatechange = () => {
      this.syncInputs(access);
      this.notifyState();
    };
  }

  private unbindAccess(): void {
    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
      this.midiAccess.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    }
  }

  private syncInputs(access: MIDIAccess): void {
    const connectedInputs: MIDIInput[] = [];
    access.inputs.forEach((input) => {
      if (input.state === 'connected') {
        connectedInputs.push(input);
        input.onmidimessage = (event: MIDIMessageEvent) => {
          if (event.data) {
            this.dispatchMidiData(event.data, event.timeStamp);
          }
        };
      } else {
        input.onmidimessage = null;
      }
    });
    this.connectedInputCount = connectedInputs.length;
  }

  private notifyState(): void {
    this.onStateChange?.(this.getState());
  }
}
