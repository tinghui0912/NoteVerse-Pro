export type RevisionOrigin = 'OMR' | 'EDIT' | 'IMPORT';
export type FingeringHandSize = 'XXS' | 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type RevisionSourceFormat = 'MUSICXML';
export type RenderAssetKind = 'RENDERED_PAGE';

export interface ScoreCapabilities {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_manage_sharing: boolean;
  can_manage_members: boolean;
  can_download: boolean;
  can_practice: boolean;
  can_publish: boolean;
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
}

export type DerivedAssetStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface ScoreDerivedAsset {
  status: DerivedAssetStatus;
  asset_id: string | null;
  revision_id: string | null;
  is_fallback: boolean;
}

export interface ScoreDerivedAssets {
  preview: ScoreDerivedAsset;
  audio: ScoreDerivedAsset;
}

export interface ScoreInputAsset {
  asset_id: string;
  filename: string;
  mime_type: string;
  size: number;
  sha256: string;
  page_number: number | null;
}

export interface ScoreDetail {
  score_id: string;
  title: string;
  taxonomy_tags: ScoreTaxonomyTag[];
  version: number;
  head_revision_id: string | null;
  derived_assets: ScoreDerivedAssets;
  input_assets: ScoreInputAsset[];
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
  created_by: InviteActor | null;
  restore: {
    restored_from_revision_id: string | null;
    restored_from_revision_number: number | null;
    note: string | null;
    actor: InviteActor | null;
    created_at: string;
  } | null;
  note: {
    note: string;
    author: InviteActor | null;
    updated_at: string;
  } | null;
}

export interface ScoreRevisionList {
  items: ScoreRevision[];
  next_cursor: number | null;
}

export interface ScoreRevisionContent extends ScoreRevision {
  content: string;
  mime_type: string;
}

export interface FingeringResult {
  content: string;
}

export interface RevisionSource {
  source_id: string;
  revision_id: string;
  format: RevisionSourceFormat;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  sha256: string;
  generator: string;
  generator_version: string;
  created_at: string;
  available: boolean;
}

export interface RenderAsset {
  render_asset_id: string;
  revision_id: string;
  kind: RenderAssetKind;
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

export interface ScoreRevisionAssets {
  revision_sources: RevisionSource[];
  render_assets: RenderAsset[];
}

export interface ScoreGrant {
  grant_id: string;
  token: string | null;
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
  derived_assets: ScoreDerivedAssets;
  revision_assets: ScoreRevisionAssets;
}

export interface ScoreGrantBookmark {
  entry_id: string;
  score_id: string;
  title: string;
  available: boolean;
  unavailable_reason: string | null;
  created_at: string;
}

export type MembershipRole = 'EDITOR' | 'VIEWER';
export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'DECLINED';

export interface InviteActor {
  display_name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface ScoreInvite {
  invite_id: string;
  email: string;
  role: MembershipRole;
  status: InviteStatus;
  expires_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  declined_at: string | null;
  created_at: string;
  created_by: InviteActor | null;
  accepted_by: InviteActor | null;
}

export interface CreatedScoreInvite extends ScoreInvite {
  token: string;
}

export interface ScoreInviteAccess {
  invite_id: string;
  score_id: string;
  score_title: string;
  inviter: InviteActor | null;
  email: string;
  role: MembershipRole;
  status: InviteStatus;
  expires_at: string | null;
  requires_login: boolean;
  can_accept: boolean;
}

export interface PendingScoreInvite {
  invite_id: string;
  score_id: string;
  score_title: string;
  inviter: InviteActor | null;
  email: string | null;
  role: MembershipRole;
  status: InviteStatus;
  expires_at: string | null;
  created_at: string;
}

export interface ScoreInviteAcceptResult {
  score_id: string;
  role: MembershipRole;
  membership_id: number | null;
}

export interface ScoreMember {
  membership_id: number;
  user_id: number;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
  role: MembershipRole;
  created_at: string;
  revoked_at: string | null;
}

export interface NotificationActor {
  display_name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface NotificationEvent {
  notification_id: string;
  type: string;
  title: string;
  body: string | null;
  resource_type: string;
  resource_id: string | null;
  score_id: string | null;
  actor: NotificationActor | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationUnreadCount {
  count: number;
}

export interface Publication {
  public_slug: string;
  score_id: string;
  revision_id: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
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
  derived_assets: ScoreDerivedAssets;
  revision_assets: ScoreRevisionAssets;
  capabilities: ScoreCapabilities;
}
