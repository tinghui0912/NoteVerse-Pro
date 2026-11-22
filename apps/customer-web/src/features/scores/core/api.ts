import type { FingeringRequest, RevisionCreateRequest, RevisionNoteUpdateRequest, RevisionRestoreRequest, ScoreRenderAssetsArchiveData, ScoreRevisionAssetsListData, ScoreRevisionsListData, ScoreUpdateRequest } from '@/generated/api';
import { scoreFingeringGenerate, scoreInputAssetDownload, scoreRenderAssetDownload, scoreRenderAssetsArchive, scoreRevisionAssetsList, scoreRevisionContentGet, scoreRevisionNoteUpdate, scoreRevisionRestore, scoreRevisionSourceDownload, scoreRevisionsCreate, scoreRevisionsList, scoresBatchDelete, scoresGet, scoresUpdate } from '@/generated/api';
import { customerTransport, responseBody } from '@/lib/http/customer-browser-transport';
import { scorePlaybackUrl } from '@/lib/api/native-resource-urls';

export const scoresApi = {
  detail: (scoreId: string, signal?: AbortSignal) =>
    responseBody(scoresGet({ ...customerTransport.authenticated, path: { score_id: scoreId }, signal })),
  update: (
    scoreId: string,
    input: ScoreUpdateRequest
  ) => responseBody(scoresUpdate({ ...customerTransport.authenticated, path: { score_id: scoreId }, body: input })),
  batchDelete: (scoreIds: string[]) =>
    responseBody(scoresBatchDelete({ ...customerTransport.authenticated, body: { score_ids: scoreIds } })),
  revisionContent: (scoreId: string, revisionId: string, signal?: AbortSignal) =>
    responseBody(scoreRevisionContentGet({ ...customerTransport.authenticated, path: { score_id: scoreId, revision_id: revisionId }, signal })),
  revisions: (scoreId: string, params?: ScoreRevisionsListData['query'], signal?: AbortSignal) =>
    responseBody(scoreRevisionsList({
      ...customerTransport.authenticated, path: { score_id: scoreId }, query: {
        limit: params?.limit,
        cursor: params?.cursor ?? undefined,
      }, signal
    })),
  createRevision: (
    scoreId: string,
    input: RevisionCreateRequest
  ) => responseBody(scoreRevisionsCreate({ ...customerTransport.authenticated, path: { score_id: scoreId }, body: input })),
  restoreRevision: (scoreId: string, revisionId: string, input: RevisionRestoreRequest) =>
    responseBody(scoreRevisionRestore({ ...customerTransport.authenticated, path: { score_id: scoreId, revision_id: revisionId }, body: input })),
  updateRevisionNote: (scoreId: string, revisionId: string, input: RevisionNoteUpdateRequest) =>
    responseBody(scoreRevisionNoteUpdate({ ...customerTransport.authenticated, path: { score_id: scoreId, revision_id: revisionId }, body: input })),
  generateFingering: (
    scoreId: string,
    input: FingeringRequest
  ) => responseBody(scoreFingeringGenerate({ ...customerTransport.authenticated, path: { score_id: scoreId }, body: input })),
  revisionAssets: (
    scoreId: string,
    params?: ScoreRevisionAssetsListData['query'],
    signal?: AbortSignal
  ) => responseBody(scoreRevisionAssetsList({ ...customerTransport.authenticated, path: { score_id: scoreId }, query: params, signal })),
  downloadInputAsset: (scoreId: string, assetId: string) =>
    responseBody(scoreInputAssetDownload({ ...customerTransport.authenticated, path: { score_id: scoreId, asset_id: assetId }, parseAs: 'blob' })),
  downloadRevisionSource: (sourceId: string) =>
    responseBody(scoreRevisionSourceDownload({ ...customerTransport.authenticated, path: { source_id: sourceId }, parseAs: 'blob' })),
  downloadRenderAsset: (renderAssetId: string) =>
    responseBody(scoreRenderAssetDownload({ ...customerTransport.authenticated, path: { render_asset_id: renderAssetId }, parseAs: 'blob' })),
  downloadRenderAssetArchive: (scoreId: string, revisionId: string, kind: NonNullable<ScoreRenderAssetsArchiveData['query']>['kind'], renderProfile: string) =>
    responseBody(scoreRenderAssetsArchive({ ...customerTransport.authenticated, path: { score_id: scoreId }, query: { revision_id: revisionId, kind, render_profile: renderProfile }, parseAs: 'blob' })),
  playbackUrl: scorePlaybackUrl,
};
