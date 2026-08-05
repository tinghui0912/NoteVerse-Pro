import type { DraftEntry } from '@/lib/editor/draft-storage';
import type { ValidationResult } from '@/lib/musicxml/validator';
import type { FingeringHandSize, ScoreCapabilities } from '@/types/api';

export interface EditorWorkspaceDocument {
  currentXml: string | null;
  draftDialogOpen?: boolean;
  finalLoadError: string | null;
  fingeringPending?: boolean;
  generateFingering?: (handSize: FingeringHandSize) => void;
  isAutoSaving: boolean;
  isLoading: boolean;
  normalizeVoices: () => Promise<void>;
  originalImages: { src: string; alt: string }[];
  pendingDraft?: DraftEntry | null;
  recoverDraft?: () => Promise<void>;
  discardDraft?: () => Promise<void>;
  save: () => void;
  saveIgnoringWarnings: () => void;
  savePending: boolean;
  scoreCapabilities?: ScoreCapabilities;
  setDraftDialogOpen?: (open: boolean) => void;
  setValidationDialogOpen: (open: boolean) => void;
  validationDialogOpen: boolean;
  validationResult: ValidationResult | null;
}
