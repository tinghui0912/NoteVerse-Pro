export type ScoreState = 'IN_REVIEW' | 'ACTIVE';
export type RevisionOrigin = 'OMR' | 'EDIT' | 'IMPORT';
export type FingeringHandSize = 'XXS' | 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type ArtifactKind =
  | 'MUSICXML'
  | 'RENDERED_PAGE'
  | 'EXPORT_PDF'
  | 'AUDIO_PREVIEW'
  | 'DIAGNOSTIC_JSON';

export interface ScoreCapabilities {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_manage_sharing: boolean;
  can_download: boolean;
  can_practice: boolean;
  can_publish: boolean;
  can_approve: boolean;
}

export interface ScoreMetadata {
  revision_id: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  measure_count: number | null;
  playback_duration_ms: number | null;
  part_count: number | null;
  primary_key_fifths: number | null;
  primary_mode: string | null;
  key_signature_events: Array<Record<string, unknown>>;
  time_signature_events: Array<Record<string, unknown>>;
  tempo_events: Array<Record<string, unknown>>;
  extractor_version: string;
  error_code: string | null;
  computed_at: string | null;
}

export interface ScoreTaxonomyTag {
  category: string;
  code: string;
  source: string;
  confidence: number | null;
}

export interface ScorePublicationSummary {
  public_slug: string;
  revision_id: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
  discoverability: 'LISTED' | 'UNLISTED';
}

export interface ScoreDetail {
  score_id: string;
  title: string;
  taxonomy_tags: ScoreTaxonomyTag[];
  state: ScoreState;
  version: number;
  head_revision_id: string | null;
  approved_revision_id: string | null;
  thumbnail_artifact_id: string | null;
  publication: ScorePublicationSummary | null;
  originating_job_id: string | null;
  metadata: ScoreMetadata | null;
  capabilities: ScoreCapabilities;
  created_at: string;
  updated_at: string;
}

export interface ScoreRevision {
  revision_id: string;
  revision_number: number;
  parent_revision_id: string | null;
  base_revision_id: string | null;
  content_hash: string;
  origin: RevisionOrigin;
  created_at: string;
}

export interface ScoreRevisionContent extends ScoreRevision {
  content: string;
  mime_type: string;
}

export interface FingeringResult {
  content: string;
}

export interface ScoreArtifact {
  artifact_id: string;
  revision_id: string;
  kind: ArtifactKind;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  sha256: string;
  page_number: number | null;
  render_profile: string | null;
  generator: string;
  generator_version: string;
  created_at: string;
  available: boolean;
}

export interface ScoreGrant {
  grant_id: string;
  token: string | null;
  target_mode: 'LATEST' | 'PINNED';
  target_revision_id: string | null;
  allow_download: boolean;
  allow_practice: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreatedScoreGrant extends Omit<ScoreGrant, 'revoked_at' | 'token'> {
  token: string;
}

export interface ScoreGrantAccess {
  score_id: string;
  revision_id: string;
  title: string;
  taxonomy_tags: ScoreTaxonomyTag[];
  shared_by: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  shared_at: string;
  capabilities: ScoreCapabilities;
  metadata: ScoreMetadata | null;
  artifacts: ScoreArtifact[];
}

export interface ScoreGrantContent {
  score_id: string;
  revision_id: string;
  content: string;
  mime_type: string;
}

export interface ScoreGrantBookmark {
  entry_id: string;
  score_id: string;
  title: string;
  available: boolean;
  unavailable_reason: string | null;
  created_at: string;
}

export interface Publication {
  public_slug: string;
  score_id: string;
  revision_id: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
  discoverability: 'LISTED' | 'UNLISTED';
  allow_download: boolean;
  allow_practice: boolean;
  published_at: string;
  updated_at: string;
}

export interface PublicScore {
  publication: Publication;
  title: string;
  taxonomy_tags: ScoreTaxonomyTag[];
  metadata: ScoreMetadata | null;
  artifacts: ScoreArtifact[];
  capabilities: ScoreCapabilities;
}

export interface PublicScoreContent {
  score_id: string;
  revision_id: string;
  content: string;
  mime_type: string;
}
