// This wrapper executes the exact production class; it only annotates messages.
export function instrumentWorklet(source) {
 return `const originalRegister = globalThis.registerProcessor;
globalThis.registerProcessor = (name, Base) => originalRegister(name, class extends Base {
 constructor() {
  super(); this.diagnosticRows = []; this.diagnosticProcesses = []; this.diagnosticQuantum = 0;
  const post = this.port.postMessage.bind(this.port);
  this.port.postMessage = (message, transfer) => {
   const row = { sequence: message.sequence ?? this.sequence, nextSequence: this.sequence,
    nextAck: this.nextAck, unackedDepth: this.sequence - this.nextAck,
    currentFrame, currentTime, renderQuantum: this.diagnosticQuantum,
    samples: message.samples?.length, sourceSampleRateHz: sampleRate, inputChannelCount: message.inputChannelCount,
    audioContextStartFrame: message.audioContextStartFrame, captureTimeSeconds: message.captureTimeSeconds,
    sourceStartSampleIndex: message.sourceStartSampleIndex,
    sourceEndSampleIndex: message.sourceEndSampleIndex };
   this.diagnosticRows.push(row); if (this.diagnosticRows.length > 64) this.diagnosticRows.shift();
   message.__qualificationTransport = message.type === 'capture-failure' || message.sequence < 2
    ? { ...row, workletRows: [...this.diagnosticRows], processRows: [...this.diagnosticProcesses] } : row;
   post(message, transfer ?? []);
  };
 }
 process(inputs, outputs, parameters) {
  this.diagnosticQuantum = inputs[0]?.[0]?.length ?? 0;
  this.diagnosticProcesses.push({ currentFrame, currentTime, inputChannelCount: inputs[0]?.length ?? 0,
    renderQuantum: this.diagnosticQuantum });
  if (this.diagnosticProcesses.length > 64) this.diagnosticProcesses.shift();
  return super.process(inputs, outputs, parameters);
 }
});
${source}`;
}
