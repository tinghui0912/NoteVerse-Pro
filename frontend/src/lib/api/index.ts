/**
 * API 模块统一导出
 * 类型定义请从 @/types/api 导入
 */

// API 客户端
export {
    apiClient,
    ApiError,
} from '../api-client';

// 认证 API
export { authApi } from './auth';

// 任务 API
export { tasksApi } from './tasks';

// 文件 API
export { filesApi } from './files';

// XML 编辑 API
export { xmlApi } from './xml';

// 分享 API
export { sharesApi } from './shares';

// 个人资料 API
export { profileApi } from './profile';

// 练琴应用 API
export { practiceApi } from './practice';
