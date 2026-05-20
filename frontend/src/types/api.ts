/**
 * API 响应类型定义
 * 统一管理所有后端 API 响应类型
 */

// ============ 通用响应类型 ============

/** API 基础响应结构 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    message?: string;
    data?: T;
    code?: string;
    error?: string;
    details?: Record<string, unknown>;
}

/** 分页响应结构 */
export interface PaginatedResponse<T> {
    success: boolean;
    data: T[];
    pagination: {
        page: number;
        page_size: number;
        total: number;
        total_pages: number;
    };
}

// ============ 认证相关 ============

export interface LoginRequest {
    username: string; // email
    password: string;
}

export interface LoginResponse {
    access_token: string;
    token_type: string;
}

export interface RegisterRequest {
    email: string;
    password: string;
    display_name?: string;
    verified_token: string;
}

export interface User {
    id: number;
    email: string;
    display_name?: string;
    avatar_url?: string;
    is_active: boolean;
    role?: string;
    created_at?: string;
}

export interface SendCodeResponse {
    challenge_id: string;
    message?: string;
    cooldown?: number;
}

export interface VerifyCodeResponse {
    verified_token?: string;
    reset_token?: string;
    message?: string;
}

// ============ 用户资料 ============

export interface UserProfile {
    user: {
        id: number;
        username?: string;
        email: string;
        created_at?: string;
        is_active: boolean;
        is_superuser?: boolean;
        avatar_url?: string;
    };
}

export interface UpdateProfileRequest {
    email?: string;
    current_password?: string;
    new_password?: string;
}

export interface AvatarResponse {
    avatar_url: string;
    filename: string;
}

// ============ 任务相关 ============

export type TaskState = 'PENDING' | 'PROGRESS' | 'PENDING_REVIEW' | 'SUCCESS' | 'FAILURE';

export interface Task {
    task_id: string;
    state: TaskState;
    progress: number;
    current_step?: string;
    title?: string;
    difficulty?: string;
    thumbnail_type?: string;
    created_at?: string;
    started_at?: string;
    finished_at?: string;
    error?: string;
    code?: string;
}

export interface TaskDetails extends Task {
    steps: TaskStep[];
    files: Record<string, TaskFile[]>;
}

export interface TaskStep {
    name: string;
    status: string;
    start_time?: string;
    end_time?: string;
}

export interface TaskFile {
    path: string;
    page?: number;
    size?: number;
    mime_type?: string;
}

export interface BatchSubmitRequest {
    file_ids: string[];
    options?: Record<string, unknown>;
}

export interface BatchStatusResponse {
    tasks: Record<string, {
        state: TaskState;
        progress: number;
        error?: string;
    }>;
}

export interface BatchDeleteResponse {
    deleted_count: number;
    skipped_running: number;
    not_found: number;
}

export interface ArchiveResult {
    blob: Blob;
    downloadedCount: number;
    skippedCount: number;
}

// ============ 文件相关 ============

export interface UploadedFile {
    file_id: string;
    filename: string;
    size: number;
    mime_type: string;
    is_duplicate: boolean;
}

export interface TaskFiles {
    preview_image?: FileInfo[];
    enhanced_xml?: FileInfo[];
    current_xml?: FileInfo[];
    final_xml?: FileInfo[];
    final_image?: FileInfo[];
}

export interface FileInfo {
    path: string;
    page?: number;
    size?: number;
    mime_type?: string;
}

// ============ 分享相关 ============

export interface Share {
    id: number;
    share_token: string;
    task_id: string;
    expires_at?: string;
    revoked_at?: string;
    can_download: boolean;
    can_edit: boolean;
    created_at?: string;
}

export interface ShareListResponse {
    shares: Share[];
    total: number;
    page: number;
    page_size: number;
}

export interface CreateShareResponse {
    share_token: string;
    expires_at: string;
}

export interface SharedTaskInfo {
    task: {
        task_id: string;
        state: string;
        progress: number;
        title?: string;
        difficulty?: string;
        files: Record<string, Array<{
            path: string;
            page?: number;
        }>>;
    };
    share_info: {
        shared_by?: string;
        expires_at?: string;
        can_download: boolean;
        can_edit: boolean;
    };
}

export interface SavedShare {
    id: number;
    share_id: number;
    task_id: string;
    saved_at: string;
}

export interface SavedShareItem {
    id: number;
    share_token: string;
    task_id: string;
    task_title: string;
    task_state: string;
    thumbnail_type?: string;
    shared_by?: string;
    created_at: string;
}

export interface SavedShareListResponse {
    data: SavedShareItem[];
    pagination: {
        page: number;
        page_size: number;
        total: number;
        total_pages: number;
    };
}

// ============ XML 编辑相关 ============

export interface InitSessionResponse {
    session_id?: string;
    task_id: string;
}

export interface PreviewResponse {
    preview_url: string;
}

export interface SaveResponse {
    task_id: string;
    file_type: string;
    file_path: string;
}

export interface SaveAndRenderResponse {
    task_id: string;
    final_xml: string;
    final_images: Array<{
        page: number;
        url: string;
    }>;
    image_count: number;
}

export interface FingeringResponse {
    file_id: number;
    filename: string;
    size: number;
    hand: string;
    depth: number;
    download_url: string;
}

// ============ 练琴分析相关 ============

export type PracticeSource = 'final' | 'current';
export type PracticeSessionState = 'CREATED' | 'STREAMING' | 'PAUSED' | 'FINISHED' | 'FAILED';
export type PracticeReportStatus = 'NOT_REQUESTED' | 'PENDING' | 'READY' | 'FAILED';

export interface CreatePracticeSessionRequest {
    task_id: string;
    source: PracticeSource;
    share_token?: string;
    sample_rate?: number;
    channels?: number;
    frame_format?: string;
}

export interface PracticeSessionSummary {
    session_id: string;
    state: PracticeSessionState;
    ws_url?: string;
}

export interface PracticeSessionDetail {
    session_id: string;
    task_id: string;
    state: PracticeSessionState;
    source: PracticeSource;
    share_token?: string | null;
    sample_rate: number;
    channels: number;
    frame_format: string;
    started_at?: string | null;
    finished_at?: string | null;
    last_beat_position?: number | null;
    last_confidence?: number | null;
    report_status: PracticeReportStatus;
}

export interface PracticeReportPayload {
    summary: string;
    metrics: Record<string, string | number | null>;
    recommendations: string[];
}

export interface PracticeReportResponse {
    session_id: string;
    report_status: PracticeReportStatus;
    report_payload?: PracticeReportPayload | null;
}

export interface PracticeSessionReadyMessage {
    type: 'session.ready';
    payload: {
        session_id: string;
        state: PracticeSessionState;
    };
}

export interface PracticeSessionArmedMessage {
    type: 'session.armed';
    payload: {
        session_id: string;
    };
}

export interface PracticeSessionStateChangedMessage {
    type: 'session.state_changed';
    payload: {
        state: PracticeSessionState;
    };
}

export interface PracticeSessionFinishedMessage {
    type: 'session.finished';
    payload: {
        state: PracticeSessionState;
    };
}

export interface PracticeAlignmentUpdateMessage {
    type: 'alignment.update';
    payload: {
        beat_position: number;
        confidence: number;
        timestamp_ms: number;
        score_completed?: boolean;
    };
}

export interface PracticeSessionWarningMessage {
    type: 'session.warning';
    payload: {
        code: string;
        message: string;
    };
}

export interface PracticeSessionErrorMessage {
    type: 'session.error';
    payload: {
        code: string;
        message: string;
    };
}

export type PracticeServerMessage =
    | PracticeSessionReadyMessage
    | PracticeSessionArmedMessage
    | PracticeSessionStateChangedMessage
    | PracticeSessionFinishedMessage
    | PracticeAlignmentUpdateMessage
    | PracticeSessionWarningMessage
    | PracticeSessionErrorMessage;
