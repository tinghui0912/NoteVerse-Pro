// Audio/raw-only research functions. Truth selection and scoring live elsewhere.
export const DEFINITIONS = Object.freeze({
  decoded: { groupingMs: 35, onset: .30, frame: .05 },
  rise: { groupingMs: 35, onset: .30, frame: .05, previousFrames: 5, contrast: .15, peakRadius: 2 },
  support: { groupingMs: 35, onset: .30, frame: .05, previousFrames: 8, contrast: .25,
    peakRadius: 2, supportRise: .05, strongContrast: .50 },
});

export function groupEvidence(items, rate, domain, detectorIdentity) {
  const sorted = items.slice().sort((a, b) => a.anchor - b.anchor || a.available - b.available);
  const groups = [];
  for (const item of sorted) {
    const last = groups.at(-1);
    if (last && item.anchor - last.sourceAnchorSample <= rate * .035) {
      last.evidenceAvailableThroughSourceSample = Math.max(last.evidenceAvailableThroughSourceSample, item.available);
    } else {
      groups.push({ candidateId: `${domain}:${detectorIdentity}:${item.anchor}`, sourceDomainId: domain,
        sourceAnchorSample: item.anchor, evidenceAvailableThroughSourceSample: item.available, detectorIdentity });
    }
  }
  return groups.map(Object.freeze);
}

export function rawEvidence(onset, frame, window, definition) {
  if (onset.length !== 183 * 88 || frame.length !== onset.length
    || onset.some(v => !Number.isFinite(v)) || frame.some(v => !Number.isFinite(v))) throw Error('INVALID_RAW');
  const result = [];
  for (let p = 0; p < 88; p++) {
    for (let i = definition.previousFrames; i < 183 - definition.peakRadius; i++) {
      const value = onset[i * 88 + p], support = frame[i * 88 + p];
      if (value < definition.onset || support < definition.frame) continue;
      let peak = true;
      for (let j = i - definition.peakRadius; j <= i + definition.peakRadius; j++) {
        if (onset[j * 88 + p] > value || (j < i && onset[j * 88 + p] === value)) peak = false;
      }
      if (!peak) continue;
      let pre = value, preSupport = support;
      for (let j = i - definition.previousFrames; j < i; j++) {
        pre = Math.min(pre, onset[j * 88 + p]); preSupport = Math.min(preSupport, frame[j * 88 + p]);
      }
      const contrast = value - pre;
      if (contrast < definition.contrast) continue;
      if (definition.supportRise !== undefined && support - preSupport < definition.supportRise
        && contrast < definition.strongContrast) continue;
      const anchor = window.start + i * 160;
      if (anchor >= window.ownedStart && anchor < window.ownedEnd) result.push({ anchor, available: window.end });
    }
  }
  return result;
}
