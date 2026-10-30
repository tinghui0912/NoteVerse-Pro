import { isPracticePianoKey } from '@/lib/practice/kernel/piano-key';
import type { ContinuousMidiPort, ContinuousPlatform, MidiConnection } from './continuous-input';

export class ContinuousMidiInput {
  private readonly port: ContinuousMidiPort;
  constructor(platform: Pick<ContinuousPlatform, 'createMidi'>, connection: MidiConnection) {
    this.port = platform.createMidi({ access: connection.access, timebase: connection.timebase, onAttack: fact => { if (isPracticePianoKey(fact.noteNumber)) connection.observe({
      captureTime: fact.sessionTime, pianoKey: fact.noteNumber, confidence: fact.confidence,
    }); } });
  }
  prepare(): Promise<void> { return this.port.start(); }
  refreshInputs(): void { this.port.refreshInputs(); }
  dispose(): void { this.port.dispose(); }
}
