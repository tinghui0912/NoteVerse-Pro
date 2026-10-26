export const SCORE_DECORATIONS = {
  cursor: 'practice-playhead-cursor',
  cursorAttribute: 'data-practice-playhead-cursor',
  activeNote: 'practice-note-active',
  supported: 'practice-summary-note-supported',
  wrong: 'practice-summary-note-wrong',
  missed: 'practice-summary-note-missed',
  rangeBackground: 'practice-range-background',
  rangeBackgroundAttribute: 'data-practice-range-background',
  rangeSelected: 'practice-range-selected',
} as const;

export const REPORT_NOTE_CLASSES = [SCORE_DECORATIONS.supported, SCORE_DECORATIONS.wrong, SCORE_DECORATIONS.missed] as const;
