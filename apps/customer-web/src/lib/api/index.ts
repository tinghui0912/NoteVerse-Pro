/**
 * API 模块统一导出。
 * 通用传输类型从 `@/lib/api-client` 导入，HTTP DTO 从生成契约导入。
 */

// API 客户端
export {
    apiClient,
    ApiError,
} from '../api-client';

// 认证 API
export { authApi } from './auth';

// 任务 API
export { importJobsApi } from './import-jobs';

// 文件 API
export { filesApi } from './files';

// XML 编辑 API

// 分享 API

// 个人资料 API
export { profileApi } from './profile';

// 练琴应用 API
export { practiceApi } from './practice';
export { scoresApi } from './scores';
export { scoreSharingApi } from './score-sharing';
export { scoreInvitesApi } from './score-invites';
export { notificationsApi } from './notifications';
export { publicationsApi } from './publications';
export { libraryApi } from './library';
export { myScoresApi } from './my-scores';
export { reviewApi } from './review';
export { storageUsageApi } from './storage-usage';
