import type { ContinuousMidiPort, ContinuousPlatform, MidiConnection } from './continuous-input';

export class ContinuousMidiInput {
  private readonly port: ContinuousMidiPort;
  constructor(platform: Pick<ContinuousPlatform, 'createMidi'>, connection: MidiConnection) {
    this.port = platform.createMidi({ access: connection.access, timebase: connection.timebase, onAttack: fact => connection.observe({
      captureTime: fact.sessionTime, pitch: fact.pitch, confidence: fact.confidence,
    }), onStateChange: connection.onState });
  }
  prepare(): Promise<void> { return this.port.start(); }
  assertConnected(): void { if (this.port.getState().connectedInputCount === 0) throw new Error('NO_CONNECTED_INPUT'); }
  dispose(): void { this.port.dispose(); }
}
