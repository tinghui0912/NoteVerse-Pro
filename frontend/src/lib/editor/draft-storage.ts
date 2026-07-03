import Dexie, { type Table } from 'dexie';

export interface DraftEntry {
  draftId: string;
  scoreId: string;
  baseRevisionId: string;
  xml: string;
  savedAt: number;
}

class DraftDatabase extends Dexie {
  drafts!: Table<DraftEntry, string>;

  constructor() {
    super('NoteVerseEditorDrafts');
    this.version(1).stores({
      drafts: 'draftId, scoreId, baseRevisionId, savedAt',
    });
  }
}

let db: DraftDatabase | null = null;

function getDB(): DraftDatabase {
  if (!db && typeof window !== 'undefined') db = new DraftDatabase();
  if (!db) throw new Error('IndexedDB is not available');
  return db;
}

function draftId(scoreId: string, baseRevisionId: string) {
  return `${scoreId}:${baseRevisionId}`;
}

function draftTable() {
  return getDB().drafts;
}

export async function saveDraft(
  scoreId: string,
  baseRevisionId: string,
  xml: string
): Promise<void> {
  try {
    await draftTable().put({
      draftId: draftId(scoreId, baseRevisionId),
      scoreId,
      baseRevisionId,
      xml,
      savedAt: Date.now(),
    });
  } catch (error) {
    console.error('[DraftStorage] Failed to save draft:', error);
  }
}

export async function loadDraft(
  scoreId: string,
  baseRevisionId: string
): Promise<DraftEntry | undefined> {
  try {
    return await draftTable().get(draftId(scoreId, baseRevisionId));
  } catch (error) {
    console.error('[DraftStorage] Failed to load draft:', error);
    return undefined;
  }
}

export async function deleteDraft(scoreId: string, baseRevisionId: string): Promise<void> {
  try {
    await draftTable().delete(draftId(scoreId, baseRevisionId));
  } catch (error) {
    console.error('[DraftStorage] Failed to delete draft:', error);
  }
}

export async function cleanOldDrafts(maxAgeDays = 7): Promise<number> {
  try {
    const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const oldDrafts = draftTable().where('savedAt').below(threshold);
    const count = await oldDrafts.count();
    await oldDrafts.delete();
    return count;
  } catch (error) {
    console.error('[DraftStorage] Failed to clean old drafts:', error);
    return 0;
  }
}
