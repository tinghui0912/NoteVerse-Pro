/**
 * Central API module exports.
 * Import transport primitives from `@/lib/api-client` and HTTP DTOs from generated contracts.
 */

export {
    apiClient,
    ApiError,
} from '../api-client';

// Authentication API.
export { authApi } from './auth';

// Import job API.
export { importJobsApi } from './import-jobs';

// File API.
export { filesApi } from './files';

// XML editing API.

// Sharing API.

// Profile API.
export { profileApi } from './profile';

// Practice API.
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
