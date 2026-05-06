/**
 * Centralized constants for the application
 * 
 * This index file re-exports all constants from domain-specific files
 * for convenient importing throughout the application.
 * 
 * @example
 * ```typescript
 * // Option 1: Import from specific domain file
 * import { DEFAULT_TEMPO_BPM } from '@/lib/constants/audio';
 * 
 * // Option 2: Import from index (all constants)
 * import { DEFAULT_TEMPO_BPM } from '@/lib/constants';
 * ```
 */

export * from './audio';
