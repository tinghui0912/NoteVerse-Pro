import { emptyPracticePreferences, type PracticePreferenceProfile } from './preferences';

export const PRACTICE_PREFERENCES_KEY = 'noteverse.practice.preferences.v1';
type StoragePort = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const exactKeys = (value: object, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();
export function parsePracticePreferences(raw: string | null): PracticePreferenceProfile {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || !exactKeys(value, ['schemaVersion', 'mode', 'inputSource', 'continuous']) || value.schemaVersion !== 1
      || ![null, 'STEP_BY_STEP', 'CONTINUOUS_PLAY'].includes(value.mode)
      || ![null, 'MICROPHONE', 'MIDI'].includes(value.inputSource)
      || !value.continuous || !exactKeys(value.continuous, ['recordingMode', 'liveFeedbackEnabled'])
      || ![null, 'OFF', 'AUDIO', 'VIDEO'].includes(value.continuous.recordingMode)
      || typeof value.continuous.liveFeedbackEnabled !== 'boolean') return emptyPracticePreferences;
    return Object.freeze({ ...value, continuous: Object.freeze({ ...value.continuous }) });
  } catch { return emptyPracticePreferences; }
}
export function readPracticePreferences(storage: StoragePort): PracticePreferenceProfile {
  try { return parsePracticePreferences(storage.getItem(PRACTICE_PREFERENCES_KEY)); } catch { return emptyPracticePreferences; }
}
export function writePracticePreferences(storage: StoragePort, profile: PracticePreferenceProfile): void {
  try { storage.setItem(PRACTICE_PREFERENCES_KEY, JSON.stringify(profile)); } catch { /* Memory intent remains usable when persistence is denied. */ }
}
