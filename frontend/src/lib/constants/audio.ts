/**
 * Audio playback related constants
 * 
 * Centralized to avoid magic numbers and improve maintainability.
 * All values are documented with their musical meaning and usage context.
 */

/**
 * Default tempo in BPM (Beats Per Minute) when not specified in MusicXML or user input
 * 
 * @constant {number}
 * @default 100
 * 
 * @remarks
 * - 100 BPM represents "Andante" (walking pace) in musical notation
 * - Matches osmd-audio-player's default behavior when no tempo is specified
 * - Used as fallback in both ListenModal and MusicXMLParser for consistency
 * - Chosen over 120 BPM to provide a more moderate default playback speed
 * 
 * @see {@link https://en.wikipedia.org/wiki/Tempo | Tempo Markings on Wikipedia}
 */
export const DEFAULT_TEMPO_BPM = 100;

/**
 * Estimated beats per iteration step in OSMD playback
 * 
 * @constant {number}
 * @default 0.25
 * 
 * @remarks
 * - Represents a 16th note (quarter of a beat)
 * - Used for duration calculation when player.duration is unavailable or unreliable
 * - Formula: `duration = (steps × ESTIMATED_BEATS_PER_STEP × 60) / bpm`
 * - This is an approximation; actual note durations may vary based on the score
 * 
 * @example
 * ```typescript
 * const totalSteps = 109;
 * const bpm = 80;
 * const duration = (totalSteps * ESTIMATED_BEATS_PER_STEP * 60) / bpm;
 * // duration ≈ 20.4375 seconds
 * ```
 */
export const ESTIMATED_BEATS_PER_STEP = 0.25;

/**
 * OSMD's base tempo for internal timestamp calculations
 * 
 * @constant {number}
 * @default 60
 * 
 * @remarks
 * - All OSMD internal timestamps are relative to 60 BPM
 * - To convert OSMD timestamp to actual seconds: `seconds = timestamp × (60 / actualBPM)`
 * - This is a property of the OpenSheetMusicDisplay library, not configurable
 * 
 * @see {@link https://github.com/opensheetmusicdisplay/opensheetmusicdisplay | OSMD Repository}
 */
export const OSMD_BASE_TEMPO_BPM = 60;
